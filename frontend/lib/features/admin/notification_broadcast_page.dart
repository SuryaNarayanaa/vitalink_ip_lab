import 'package:flutter/material.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';

class NotificationBroadcastPage extends StatefulWidget {
  const NotificationBroadcastPage({super.key});

  @override
  State<NotificationBroadcastPage> createState() =>
      _NotificationBroadcastPageState();
}

class _NotificationBroadcastPageState extends State<NotificationBroadcastPage> {
  final AdminRepository _repo = AppDependencies.adminRepository;
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _messageCtrl = TextEditingController();
  String _target = 'ALL';
  String _priority = 'MEDIUM';
  bool _isSending = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _messageCtrl.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!_formKey.currentState!.validate()) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Send Notification?'),
        content: Text(
          'This will broadcast a $_priority priority notification to ${_target.toLowerCase()} users.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Send'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _isSending = true);
    try {
      await _repo.broadcastNotification(
        title: _titleCtrl.text.trim(),
        message: _messageCtrl.text.trim(),
        target: _target,
        priority: _priority,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Notification sent successfully'),
            backgroundColor: Colors.green,
          ),
        );
        _titleCtrl.clear();
        _messageCtrl.clear();
        setState(() {
          _target = 'ALL';
          _priority = 'MEDIUM';
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to send: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final showPageScaffold = !AdminScaffold.usesShellAppBar(context);

    final content = SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!showPageScaffold)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  'Broadcast Notification',
                  style: theme.textTheme.titleLarge,
                ),
              ),
            // Info card
            Card(
              color: theme.colorScheme.primaryContainer.withValues(
                alpha: 0.3,
              ),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(
                      Icons.info_outline,
                      color: theme.colorScheme.primary,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Broadcast a notification to selected user groups. All targeted users will receive this notification in-app.',
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Title
            TextFormField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                labelText: 'Notification Title',
                prefixIcon: Icon(Icons.title_rounded),
                border: OutlineInputBorder(),
              ),
              enabled: !_isSending,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Title is required' : null,
            ),
            const SizedBox(height: 16),

            // Message
            TextFormField(
              controller: _messageCtrl,
              decoration: const InputDecoration(
                labelText: 'Message',
                prefixIcon: Icon(Icons.message_rounded),
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
              maxLines: 4,
              enabled: !_isSending,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Message is required'
                  : null,
            ),
            const SizedBox(height: 24),

            // Target
            Text(
              'Target Audience',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _TargetChip(
                  label: 'All Users',
                  value: 'ALL',
                  icon: Icons.groups_rounded,
                  selected: _target == 'ALL',
                  onTap: () => setState(() => _target = 'ALL'),
                ),
                _TargetChip(
                  label: 'Doctors',
                  value: 'DOCTORS',
                  icon: Icons.medical_services_rounded,
                  selected: _target == 'DOCTORS',
                  onTap: () => setState(() => _target = 'DOCTORS'),
                ),
                _TargetChip(
                  label: 'Patients',
                  value: 'PATIENTS',
                  icon: Icons.people_rounded,
                  selected: _target == 'PATIENTS',
                  onTap: () => setState(() => _target = 'PATIENTS'),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Priority
            Text(
              'Priority',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                final priorityControl = SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(
                      value: 'LOW',
                      label: Text('Low'),
                      icon: Icon(Icons.arrow_downward_rounded),
                    ),
                    ButtonSegment(
                      value: 'MEDIUM',
                      label: Text('Medium'),
                      icon: Icon(Icons.remove_rounded),
                    ),
                    ButtonSegment(
                      value: 'HIGH',
                      label: Text('High'),
                      icon: Icon(Icons.arrow_upward_rounded),
                    ),
                    ButtonSegment(
                      value: 'URGENT',
                      label: Text('Urgent'),
                      icon: Icon(Icons.warning_rounded),
                    ),
                  ],
                  selected: {_priority},
                  onSelectionChanged: (v) =>
                      setState(() => _priority = v.first),
                );

                if (constraints.maxWidth >= 430) return priorityControl;

                return SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: priorityControl,
                  ),
                );
              },
            ),
            const SizedBox(height: 32),

            // Send button
            FilledButton.icon(
              onPressed: _isSending ? null : _send,
              icon: _isSending
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send_rounded),
              label: Text(_isSending ? 'Sending...' : 'Send Notification'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          ],
        ),
      ),
    );

    if (!showPageScaffold) {
      return content;
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Broadcast Notification')),
      body: content,
    );
  }
}

class _TargetChip extends StatelessWidget {
  final String label, value;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _TargetChip({
    required this.label,
    required this.value,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return FilterChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 18,
            color: selected
                ? theme.colorScheme.onPrimaryContainer
                : theme.colorScheme.onSurface,
          ),
          const SizedBox(width: 6),
          Text(label),
        ],
      ),
      selected: selected,
      onSelected: (_) => onTap(),
    );
  }
}
