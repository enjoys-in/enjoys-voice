// Ad-hoc TURN/STUN connectivity test (long-term credential, RFC 5389/5766).
// Usage: node scripts/turn-test.mjs <host> <port> <user> <pass>
import dgram from 'node:dgram';
import crypto from 'node:crypto';

const HOST = process.argv[2] || '77.237.241.24';
const PORT = Number(process.argv[3] || 3478);
const USER = process.argv[4] || 'callnet';
const PASS = process.argv[5] || 'devsecret123';
 
const MAGIC = 0x2112a442;
const T = { BIND_REQ: 0x0001, ALLOC_REQ: 0x0003 };
const A = {
  MAPPED: 0x0001, USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR: 0x0009,
  REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED: 0x0016, REQUESTED_TRANSPORT: 0x0019,
  XOR_MAPPED: 0x0020, SOFTWARE: 0x8022,
};

const txid = () => crypto.randomBytes(12);

function buildAttr(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const buf = Buffer.alloc(4 + value.length + pad);
  buf.writeUInt16BE(type, 0);
  buf.writeUInt16BE(value.length, 2);
  value.copy(buf, 4);
  return buf;
}

function buildMessage(type, tid, attrs, integrityKey) {
  let body = Buffer.concat(attrs);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt32BE(MAGIC, 4);
  tid.copy(header, 8);
  if (integrityKey) {
    // length must cover body + the MESSAGE-INTEGRITY attribute (4 + 20)
    header.writeUInt16BE(body.length + 24, 2);
    const hmac = crypto.createHmac('sha1', integrityKey)
      .update(Buffer.concat([header, body])).digest();
    body = Buffer.concat([body, buildAttr(A.MESSAGE_INTEGRITY, hmac)]);
  }
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

function parse(msg) {
  const type = msg.readUInt16BE(0);
  const len = msg.readUInt16BE(2);
  const attrs = {};
  let o = 20;
  while (o < 20 + len) {
    const at = msg.readUInt16BE(o);
    const al = msg.readUInt16BE(o + 2);
    attrs[at] = msg.subarray(o + 4, o + 4 + al);
    o += 4 + al + ((4 - (al % 4)) % 4);
  }
  return { type, attrs };
}

function readXorAddr(buf) {
  const family = buf.readUInt8(1);
  const port = buf.readUInt16BE(2) ^ (MAGIC >>> 16);
  if (family === 0x01) {
    const ip = [];
    const x = MAGIC;
    ip.push((buf.readUInt8(4) ^ ((x >>> 24) & 0xff)));
    ip.push((buf.readUInt8(5) ^ ((x >>> 16) & 0xff)));
    ip.push((buf.readUInt8(6) ^ ((x >>> 8) & 0xff)));
    ip.push((buf.readUInt8(7) ^ (x & 0xff)));
    return `${ip.join('.')}:${port}`;
  }
  return `family=${family}:${port}`;
}

const sock = dgram.createSocket('udp4');
const send = (buf) => new Promise((res, rej) => sock.send(buf, PORT, HOST, (e) => e ? rej(e) : res()));
const recv = (ms = 4000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms);
  sock.once('message', (m) => { clearTimeout(t); res(m); });
});

function errStr(buf) {
  if (!buf) return '';
  const code = buf.readUInt8(2) * 100 + buf.readUInt8(3);
  return `${code} ${buf.subarray(4).toString('utf8')}`;
}

(async () => {
  console.log(`TURN/STUN test → ${HOST}:${PORT}  user=${USER}\n`);
  try {
    // 1) STUN Binding (no auth) — proves UDP reachability + our reflexive addr
    let tid = txid();
    await send(buildMessage(T.BIND_REQ, tid, [buildAttr(A.SOFTWARE, Buffer.from('turn-test'))]));
    let { type, attrs } = parse(await recv());
    if (type === 0x0101) {
      const a = attrs[A.XOR_MAPPED] ? readXorAddr(attrs[A.XOR_MAPPED]) : '?';
      console.log(`✅ STUN Binding OK — server reachable. Your public addr: ${a}`);
    } else {
      console.log(`⚠️ STUN Binding unexpected type 0x${type.toString(16)} ${errStr(attrs[A.ERROR])}`);
    }

    // 2) TURN Allocate (no auth) — expect 401 with REALM + NONCE
    tid = txid();
    const rt = Buffer.from([17, 0, 0, 0]); // UDP
    await send(buildMessage(T.ALLOC_REQ, tid, [buildAttr(A.REQUESTED_TRANSPORT, rt)]));
    ({ type, attrs } = parse(await recv()));
    if (type !== 0x0113 || !attrs[A.REALM] || !attrs[A.NONCE]) {
      console.log(`⚠️ Allocate(no-auth) unexpected: 0x${type.toString(16)} ${errStr(attrs[A.ERROR])}`);
      sock.close(); return;
    }
    const realm = attrs[A.REALM].toString('utf8');
    const nonce = attrs[A.NONCE];
    console.log(`ℹ️ Allocate challenge: ${errStr(attrs[A.ERROR])} realm="${realm}"`);

    // 3) TURN Allocate (authenticated)
    const key = crypto.createHash('md5').update(`${USER}:${realm}:${PASS}`).digest();
    tid = txid();
    const authAttrs = [
      buildAttr(A.REQUESTED_TRANSPORT, rt),
      buildAttr(A.USERNAME, Buffer.from(USER, 'utf8')),
      buildAttr(A.REALM, Buffer.from(realm, 'utf8')),
      buildAttr(A.NONCE, nonce),
    ];
    await send(buildMessage(T.ALLOC_REQ, tid, authAttrs, key));
    ({ type, attrs } = parse(await recv()));
    if (type === 0x0103) {
      const relayed = attrs[A.XOR_RELAYED] ? readXorAddr(attrs[A.XOR_RELAYED]) : '?';
      const mapped = attrs[A.XOR_MAPPED] ? readXorAddr(attrs[A.XOR_MAPPED]) : '?';
      console.log(`✅ TURN Allocate SUCCESS — relay works!`);
      console.log(`   Relayed address: ${relayed}`);
      console.log(`   Mapped address : ${mapped}`);
    } else if (type === 0x0113) {
      console.log(`❌ TURN Allocate FAILED: ${errStr(attrs[A.ERROR])}`);
      console.log(`   (401 = bad username/password; 300/438 = stale nonce; other = config)`);
    } else {
      console.log(`❌ Allocate unexpected type 0x${type.toString(16)} ${errStr(attrs[A.ERROR])}`);
    }
  } catch (e) {
    console.log(`❌ ${e.message} — UDP ${HOST}:${PORT} not answering (firewall/port closed or server down)`);
  } finally {
    sock.close();
  }
})();
