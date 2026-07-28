import 'package:flutter/widgets.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/state/admin_access_controller.dart';

class AdminAccessScope extends InheritedNotifier<AdminAccessController> {
  const AdminAccessScope({
    super.key,
    required AdminAccessController controller,
    required super.child,
  }) : super(notifier: controller);

  static AdminAccessController of(BuildContext context, {bool listen = true}) {
    final scope = listen
        ? context.dependOnInheritedWidgetOfExactType<AdminAccessScope>()
        : context.getInheritedWidgetOfExactType<AdminAccessScope>();
    assert(scope != null, 'No AdminAccessScope found in this context');
    return scope!.notifier!;
  }

  static AdminAccessController? maybeOf(
    BuildContext context, {
    bool listen = true,
  }) {
    final scope = listen
        ? context.dependOnInheritedWidgetOfExactType<AdminAccessScope>()
        : context.getInheritedWidgetOfExactType<AdminAccessScope>();
    return scope?.notifier;
  }

  static AdminAccessModel? accessOf(BuildContext context) => of(context).access;

  static bool can(BuildContext context, String capability) =>
      of(context).can(capability);

  static bool canAny(BuildContext context, Iterable<String> capabilities) =>
      of(context).canAny(capabilities);
}
