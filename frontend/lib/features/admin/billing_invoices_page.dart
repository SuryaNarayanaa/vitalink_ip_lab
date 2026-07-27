import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/admin_query_keys.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/admin_console_components.dart';

class BillingInvoicesPage extends StatefulWidget {
  const BillingInvoicesPage({super.key});

  @override
  State<BillingInvoicesPage> createState() => _BillingInvoicesPageState();
}

class _BillingInvoicesPageState extends State<BillingInvoicesPage> {
  final _repo = AppDependencies.adminRepository;
  final _search = TextEditingController();
  int _refreshKey = 0;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _refresh() => setState(() => _refreshKey++);

  @override
  Widget build(BuildContext context) {
    return AdminAccessGate(
      anyCapabilities: AdminCapabilities.billingRead,
      builder: (context) {
        final canGenerate = AdminAccessScope.can(
          context,
          AdminCapabilities.platformBillingManage,
        );
        final canCheckout = AdminAccessScope.can(
          context,
          AdminCapabilities.tenantBillingCheckout,
        );
        return UseQuery<Map<String, dynamic>>(
          options: QueryOptions<Map<String, dynamic>>(
            queryKey: AdminQueryKeys.invoices(refreshKey: _refreshKey),
            queryFn: _repo.getInvoices,
          ),
          builder: (context, query) {
            final all = query.data?['invoices'] as List? ?? const [];
            final q = _search.text.toLowerCase();
            final invoices = all.where((item) {
              final invoice = item as Map<String, dynamic>;
              return '${invoice['id']} ${invoice['hospitalName']} ${invoice['plan']}'
                  .toLowerCase()
                  .contains(q);
            }).toList();
            final content = AdminListShell(
              title: 'Billing & Invoices',
              subtitle: canGenerate || canCheckout
                  ? 'Review invoices and use only the billing actions allowed by your policy.'
                  : 'Read-only invoice access.',
              searchController: _search,
              searchHint: 'Search invoices',
              onSearch: () => setState(() {}),
              actions: [
                if (canGenerate)
                  FilledButton.icon(
                    onPressed: _confirmInvoiceGeneration,
                    icon: const Icon(Icons.receipt_long_rounded),
                    label: const Text('Generate'),
                  ),
              ],
              child: AdminQueryBody<Map<String, dynamic>>(
                query: query,
                emptyIcon: Icons.receipt_long_outlined,
                emptyText: 'No invoices found',
                isEmpty: invoices.isEmpty,
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: invoices.length,
                  itemBuilder: (context, index) {
                    final invoice = invoices[index] as Map<String, dynamic>;
                    final id = '${invoice['id']}';
                    final status = '${invoice['status'] ?? 'Pending'}';
                    return AdminRecordCard(
                      icon: Icons.receipt_rounded,
                      title: id,
                      badge: status,
                      details: [
                        AdminDetail(
                          Icons.local_hospital_outlined,
                          '${invoice['hospitalName'] ?? invoice['hospital'] ?? '--'}',
                        ),
                        AdminDetail(
                          Icons.workspace_premium_outlined,
                          '${invoice['plan'] ?? '--'}',
                        ),
                        AdminDetail(
                          Icons.currency_rupee_rounded,
                          '${invoice['amount'] ?? 0}',
                        ),
                        AdminDetail(
                          Icons.event_outlined,
                          'Due ${formatAdminDate(invoice['due'])}',
                        ),
                      ],
                      menu: canCheckout
                          ? [
                              PopupMenuItem(
                                enabled: status != 'Paid',
                                value: 'checkout',
                                child: const Text('Create checkout'),
                                onTap: () => Future.microtask(
                                  () => _startInvoiceCheckout(id),
                                ),
                              ),
                            ]
                          : const [],
                    );
                  },
                ),
              ),
            );
            return adminPageScaffold(context, 'Billing', content);
          },
        );
      },
    );
  }

  Future<void> _confirmInvoiceGeneration() async {
    final period = TextEditingController(
      text:
          '${DateTime.now().year}-${DateTime.now().month.toString().padLeft(2, '0')}',
    );
    final billingPeriod = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Generate invoices?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'This creates invoices for every active hospital. Existing invoices for the same billing period will be kept.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: period,
              decoration: const InputDecoration(
                labelText: 'Billing period (YYYY-MM)',
                hintText: '2026-07',
              ),
              keyboardType: TextInputType.datetime,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final value = period.text.trim();
              if (RegExp(r'^\d{4}-(0[1-9]|1[0-2])$').hasMatch(value)) {
                Navigator.pop(dialogContext, value);
              } else {
                ScaffoldMessenger.of(dialogContext).showSnackBar(
                  const SnackBar(
                    content: Text('Enter a billing period as YYYY-MM.'),
                  ),
                );
              }
            },
            child: const Text('Generate'),
          ),
        ],
      ),
    );
    period.dispose();
    if (billingPeriod == null || !mounted) return;

    try {
      final result = await _repo.generateInvoices(billingPeriod: billingPeriod);
      if (!mounted) return;
      _refresh();
      final created = result['created'] as num? ?? 0;
      final existing = result['already_existing'] as num? ?? 0;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '$created created; $existing already existed for $billingPeriod.',
          ),
        ),
      );
    } catch (e) {
      if (mounted) showAdminError(context, e);
    }
  }

  Future<void> _startInvoiceCheckout(String invoiceId) async {
    try {
      final result = await _repo.createInvoiceCheckout(invoiceId);
      final checkoutUrl = result['checkout_url'] as String?;
      final uri = checkoutUrl == null ? null : Uri.tryParse(checkoutUrl);
      final isSafeScheme =
          uri != null &&
          (uri.scheme == 'https' ||
              (uri.scheme == 'http' &&
                  (uri.host == 'localhost' || uri.host == '127.0.0.1')));
      if (!isSafeScheme ||
          !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw StateError('Unable to open the configured payment checkout.');
      }
    } catch (e) {
      if (mounted) showAdminError(context, e);
    }
  }
}
