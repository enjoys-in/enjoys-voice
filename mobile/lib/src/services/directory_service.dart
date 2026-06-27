import '../models/directory.dart';
import 'api_client.dart';

/// Read-only directory data for the Recents + Contacts tabs (Go API, `/api/g`).
class DirectoryService {
  DirectoryService(this._api);

  final ApiClient _api;

  /// Call history for the signed-in user (most recent first).
  ///
  /// Prefers the user-scoped endpoint `/calls/<ext>` (same as the web client)
  /// and falls back to `/calls` if that fails or no extension is known.
  Future<List<CallRecord>> recents([String? extension]) async {
    dynamic data;
    if (extension != null && extension.isNotEmpty) {
      try {
        data = await _api.get('/calls/${Uri.encodeComponent(extension)}');
      } catch (_) {
        data = await _api.get('/calls');
      }
    } else {
      data = await _api.get('/calls');
    }
    if (data is List) {
      final list = data
          .whereType<Map<String, dynamic>>()
          .map(CallRecord.fromJson)
          .toList();
      list.sort((a, b) => b.startTime.compareTo(a.startTime));
      return list;
    }
    return const [];
  }

  /// The user's personal address book.
  Future<List<Contact>> contacts() async {
    final data = await _api.get('/contacts');
    if (data is List) {
      return data
          .whereType<Map<String, dynamic>>()
          .map(Contact.fromJson)
          .toList();
    }
    return const [];
  }

  /// Add a personal contact (`POST /contacts`). Same payload as the web client.
  Future<Contact> createContact({
    required String name,
    required String extension,
    String? username,
  }) async {
    final data = await _api.post('/contacts', {
      'name': name,
      'extension': extension,
      if (username != null && username.isNotEmpty) 'username': username,
    });
    if (data is Map<String, dynamic>) return Contact.fromJson(data);
    return Contact(name: name, extension: extension);
  }

  /// Update an existing personal contact (`PUT /contacts/<id>`).
  Future<Contact> updateContact(
    int id, {
    required String name,
    required String extension,
  }) async {
    final data = await _api.put('/contacts/$id', {
      'name': name,
      'extension': extension,
    });
    if (data is Map<String, dynamic>) return Contact.fromJson(data);
    return Contact(id: id, name: name, extension: extension);
  }

  /// Remove a personal contact (`DELETE /contacts/<id>`).
  Future<void> deleteContact(int id) => _api.delete('/contacts/$id');

  /// Purge the signed-in user's call history (`DELETE /calls/<ext>`).
  Future<void> clearRecents(String extension) =>
      _api.delete('/calls/${Uri.encodeComponent(extension)}');
}
