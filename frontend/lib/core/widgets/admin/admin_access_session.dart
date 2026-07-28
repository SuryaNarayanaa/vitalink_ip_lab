import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/features/admin/state/admin_access_controller.dart';

class AdminAccessSession extends StatefulWidget {
  const AdminAccessSession({
    super.key,
    required this.controller,
    required this.child,
  });

  final AdminAccessController controller;
  final Widget child;

  @override
  State<AdminAccessSession> createState() => _AdminAccessSessionState();
}

class _AdminAccessSessionState extends State<AdminAccessSession> {
  @override
  void initState() {
    super.initState();
    unawaited(widget.controller.start());
  }

  @override
  void didUpdateWidget(covariant AdminAccessSession oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.controller, widget.controller)) {
      oldWidget.controller.stop();
      unawaited(widget.controller.start());
    }
  }

  @override
  void dispose() {
    widget.controller.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AdminAccessScope(controller: widget.controller, child: widget.child);
  }
}
