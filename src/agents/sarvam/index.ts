import { SarvamAIClient } from "sarvamai";

const client = new SarvamAIClient({
    apiSubscriptionKey: "YOUR_SARVAM_API_KEY"
});

const response = await client.textToSpeech.convert({
    model: "bulbul:v3",
    text: "नमस्ते, आज मैं आपकी क्या मदद कर सकता हूँ?",
    target_language_code: "hi-IN",
    speaker: "shubh",
});
import { SarvamAIClient } from "sarvamai";
import fs from "fs";

const client = new SarvamAIClient({
    apiSubscriptionKey: "YOUR_SARVAM_API_KEY"
});

const audioFile = fs.createReadStream("recording.wav");

const response = await client.speechToText.transcribe({
    file: audioFile,
    model: "saaras:v3",
    mode: "transcribe"
});