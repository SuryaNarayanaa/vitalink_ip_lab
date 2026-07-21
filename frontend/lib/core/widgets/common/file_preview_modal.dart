import 'dart:async';

import 'package:flutter/material.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:url_launcher/url_launcher.dart';

/// Full-screen in-app file preview for INR report attachments.
///
/// PDFs render inside the app via [PdfViewer]; images use [Image.network].
/// External open remains available as a secondary action.
class FilePreviewModal extends StatefulWidget {
  final String fileUrl;
  final String? fileName;
  final String? fileType; // 'pdf', 'image', or auto-detect

  const FilePreviewModal({
    super.key,
    required this.fileUrl,
    this.fileName,
    this.fileType,
  });

  /// Opens a full-screen viewer route (preferred for reading PDFs).
  static Future<void> show(
    BuildContext context, {
    required String fileUrl,
    String? fileName,
    String? fileType,
  }) {
    return Navigator.of(context).push<void>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (context) => FilePreviewModal(
          fileUrl: fileUrl,
          fileName: fileName,
          fileType: fileType,
        ),
      ),
    );
  }

  @override
  State<FilePreviewModal> createState() => _FilePreviewModalState();
}

class _FilePreviewModalState extends State<FilePreviewModal> {
  bool _isOpeningExternal = false;
  late final String _detectedFileType;
  final PdfViewerController _pdfController = PdfViewerController();
  Timer? _imageLoadingTimer;
  bool _imageLoadingTimedOut = false;

  @override
  void initState() {
    super.initState();
    _detectedFileType = _resolveFileType();
  }

  @override
  void dispose() {
    _imageLoadingTimer?.cancel();
    super.dispose();
  }

  String _resolveFileType() {
    if (widget.fileType != null) return widget.fileType!;

    final urlLower = widget.fileUrl.toLowerCase();
    // Signed URLs often bury the extension before query params.
    final path = Uri.tryParse(widget.fileUrl)?.path.toLowerCase() ?? urlLower;
    if (path.endsWith('.pdf') || urlLower.contains('.pdf')) {
      return 'pdf';
    }
    if (path.endsWith('.png') ||
        path.endsWith('.jpg') ||
        path.endsWith('.jpeg') ||
        path.endsWith('.gif') ||
        path.endsWith('.webp') ||
        urlLower.contains('.png') ||
        urlLower.contains('.jpg') ||
        urlLower.contains('.jpeg') ||
        urlLower.contains('.gif') ||
        urlLower.contains('.webp')) {
      return 'image';
    }
    // INR report attachments default to PDF when type is ambiguous.
    return 'pdf';
  }

  String get _displayName {
    if (widget.fileName != null && widget.fileName!.trim().isNotEmpty) {
      return widget.fileName!;
    }
    try {
      final uri = Uri.parse(widget.fileUrl);
      final pathSegments = uri.path.split('/');
      final last = pathSegments.isNotEmpty ? pathSegments.last : '';
      final cleaned = last.split('?').first;
      if (cleaned.isNotEmpty) return cleaned;
    } catch (_) {}
    return 'Report File';
  }

  Future<void> _openExternally() async {
    try {
      setState(() => _isOpeningExternal = true);
      final uri = Uri.parse(widget.fileUrl);
      if (!await canLaunchUrl(uri)) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cannot open this file externally')),
        );
        return;
      }
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('Error opening file externally: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error opening file: $e')),
      );
    } finally {
      if (mounted) setState(() => _isOpeningExternal = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isPdf = _detectedFileType == 'pdf';

    return Scaffold(
      backgroundColor: isPdf ? const Color(0xFF1F2937) : Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0.5,
        leading: IconButton(
          icon: const Icon(Icons.close),
          tooltip: 'Close',
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isPdf ? 'PDF Report' : 'File Preview',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: Color(0xFF111827),
              ),
            ),
            Text(
              _displayName,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: Colors.grey[600],
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
        actions: [
          if (isPdf)
            IconButton(
              tooltip: 'Zoom out',
              onPressed: () {
                if (!_pdfController.isReady) return;
                unawaited(_pdfController.zoomDown());
              },
              icon: const Icon(Icons.zoom_out),
            ),
          if (isPdf)
            IconButton(
              tooltip: 'Zoom in',
              onPressed: () {
                if (!_pdfController.isReady) return;
                unawaited(_pdfController.zoomUp());
              },
              icon: const Icon(Icons.zoom_in),
            ),
          IconButton(
            tooltip: 'Open externally',
            onPressed: _isOpeningExternal ? null : _openExternally,
            icon: _isOpeningExternal
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.open_in_new),
          ),
        ],
      ),
      body: isPdf ? _buildPdfViewer() : _buildImagePreview(),
    );
  }

  Widget _buildPdfViewer() {
    final uri = Uri.tryParse(widget.fileUrl);
    if (uri == null ||
        !uri.hasScheme ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        !uri.hasAuthority ||
        uri.host.isEmpty) {
      return _ErrorPane(
        message: 'This report link is invalid or expired.',
        onDark: true,
        onRetryExternal: _openExternally,
      );
    }

    return PdfViewer.uri(
      uri,
      controller: _pdfController,
      timeout: const Duration(seconds: 45),
      params: PdfViewerParams(
        backgroundColor: const Color(0xFF1F2937),
        margin: 10,
        loadingBannerBuilder: (context, bytesDownloaded, totalBytes) {
          final progress = totalBytes != null && totalBytes > 0
              ? bytesDownloaded / totalBytes
              : null;
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 48,
                  height: 48,
                  child: CircularProgressIndicator(
                    value: progress,
                    strokeWidth: 3,
                    color: Colors.white,
                    backgroundColor: Colors.white24,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  progress == null
                      ? 'Loading PDF…'
                      : 'Loading PDF… ${(progress * 100).clamp(0, 100).toStringAsFixed(0)}%',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          );
        },
        errorBannerBuilder: (context, error, stackTrace, documentRef) {
          return _ErrorPane(
            message:
                'Could not load this PDF in the app. The link may have expired, or the file is unavailable.',
            detail: error.toString(),
            onDark: true,
            onRetryExternal: _openExternally,
          );
        },
        viewerOverlayBuilder: (context, size, handleLinkTap) => [
          PdfViewerScrollThumb(
            controller: _pdfController,
            orientation: ScrollbarOrientation.right,
            thumbSize: const Size(28, 48),
            margin: 4,
            thumbBuilder: (context, thumbSize, pageNumber, controller) {
              return Container(
                width: thumbSize.width,
                height: thumbSize.height,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.85),
                  borderRadius: BorderRadius.circular(8),
                ),
                alignment: Alignment.center,
                child: pageNumber == null
                    ? null
                    : Text(
                        '$pageNumber',
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF111827),
                        ),
                      ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildImagePreview() {
    if (_imageLoadingTimedOut) {
      return ColoredBox(
        color: const Color(0xFFF9FAFB),
        child: _ErrorPane(
          message:
              'Could not load this image in the app. The link may have expired, or the file is unavailable.',
          detail: 'Loading timed out after 45 seconds.',
          onRetryExternal: _openExternally,
        ),
      );
    }

    return ColoredBox(
      color: const Color(0xFFF9FAFB),
      child: InteractiveViewer(
        minScale: 0.8,
        maxScale: 5,
        child: Center(
          child: Image.network(
            widget.fileUrl,
            fit: BoxFit.contain,
            errorBuilder: (context, error, stackTrace) {
              _imageLoadingTimer?.cancel();
              return _ErrorPane(
                message: 'Failed to load image.',
                onRetryExternal: _openExternally,
              );
            },
            loadingBuilder: (context, child, loadingProgress) {
              if (loadingProgress == null) {
                // Image loaded successfully, cancel timeout.
                _imageLoadingTimer?.cancel();
                return child;
              }
              // Start timeout timer on first loading frame.
              if (_imageLoadingTimer == null && !_imageLoadingTimedOut) {
                _imageLoadingTimer = Timer(const Duration(seconds: 45), () {
                  if (mounted) {
                    setState(() => _imageLoadingTimedOut = true);
                  }
                });
              }
              return Center(
                child: CircularProgressIndicator(
                  value: loadingProgress.expectedTotalBytes != null
                      ? loadingProgress.cumulativeBytesLoaded /
                          loadingProgress.expectedTotalBytes!
                      : null,
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _ErrorPane extends StatelessWidget {
  const _ErrorPane({
    required this.message,
    this.detail,
    this.onDark = false,
    this.onRetryExternal,
  });

  final String message;
  final String? detail;
  final bool onDark;
  final VoidCallback? onRetryExternal;

  @override
  Widget build(BuildContext context) {
    final onSurface = onDark ? Colors.white : const Color(0xFF374151);
    final muted = onDark ? Colors.white70 : const Color(0xFF6B7280);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.picture_as_pdf_outlined, size: 48, color: muted),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: onSurface,
              ),
            ),
            if (detail != null) ...[
              const SizedBox(height: 8),
              Text(
                detail!,
                textAlign: TextAlign.center,
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, color: muted),
              ),
            ],
            if (onRetryExternal != null) ...[
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: onRetryExternal,
                icon: const Icon(Icons.open_in_new, size: 18),
                label: const Text('Open externally'),
                style: onDark
                    ? OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Colors.white54),
                      )
                    : null,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
