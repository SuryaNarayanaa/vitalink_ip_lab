// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;

import 'notification_stream_client_interface.dart';

class _WebNotificationStreamClient implements NotificationStreamClient {
  html.EventSource? _eventSource;
  final List<StreamSubscription<dynamic>> _subscriptions = [];

  @override
  Future<void> connect({
    required Uri uri,
    required String token,
    required StreamEventCallback onEvent,
    required void Function(Object error) onError,
    required void Function() onDone,
  }) async {
    await disconnect();

    final ticketUri = uri.replace(
      path: uri.path.replaceFirst(RegExp(r'/stream$'), '/stream-ticket'),
    );
    final ticketResponse = await html.HttpRequest.request(
      ticketUri.toString(),
      method: 'POST',
      requestHeaders: {'Authorization': 'Bearer $token'},
    );
    final decoded = jsonDecode(ticketResponse.responseText ?? '');
    final ticket = decoded is Map
        ? ((decoded['data'] is Map ? decoded['data']['ticket'] : null) ??
            decoded['ticket'])
        : null;
    if (ticket is! String || ticket.isEmpty) {
      throw StateError('Notification stream ticket was not returned');
    }

    final withTicket = uri.replace(queryParameters: {
      ...uri.queryParameters,
      'ticket': ticket,
    });

    final es = html.EventSource(withTicket.toString());
    _eventSource = es;

    void listenNamedEvent(String name) {
      es.addEventListener(name, (event) {
        if (event is html.MessageEvent) {
          onEvent(name, event.data?.toString() ?? '');
        }
      });
    }

    listenNamedEvent('connected');
    listenNamedEvent('doctor_update');
    listenNamedEvent('notification');

    _subscriptions.addAll([
      es.onMessage.listen((event) {
        onEvent('message', event.data?.toString() ?? '');
      }),
      es.onError.listen((_) {
        if (es.readyState == html.EventSource.CLOSED) {
          onDone();
          return;
        }
        onError(StateError('Notification stream error'));
      }),
    ]);
  }

  @override
  Future<void> disconnect() async {
    for (final sub in _subscriptions) {
      await sub.cancel();
    }
    _subscriptions.clear();
    _eventSource?.close();
    _eventSource = null;
  }
}

NotificationStreamClient createPlatformNotificationStreamClient() =>
    _WebNotificationStreamClient();
