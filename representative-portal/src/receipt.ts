import type { PortalCurrency, PortalReceipt, TransferResult } from './contracts';

type ShareableReceipt =
  & Pick<PortalReceipt, 'amount' | 'createdAt' | 'currency' | 'publicReference' | 'recipientDisplayName' | 'recipientPublicId'>
  & Partial<Pick<PortalReceipt, 'kind' | 'reversedAt' | 'status'>>;

export function receiptFromTransfer(result: TransferResult, createdAt = new Date().toISOString()): PortalReceipt {
  return {
    amount: result.amount,
    createdAt,
    currency: result.currency,
    kind: 'transfer',
    publicReference: result.publicReference,
    recipientDisplayName: result.recipient.displayName,
    recipientPublicId: result.recipient.publicId,
    status: 'completed',
  };
}

export function createSafeReceiptText(receipt: ShareableReceipt): string {
  const reversed = receipt.status === 'reversed';
  const recipientName = cleanText(receipt.recipientDisplayName || 'مستخدم');
  const publicId = /^\d{7}$/.test(receipt.recipientPublicId) ? receipt.recipientPublicId : '—';
  const reference = /^RPT-[0-9A-HJKMNP-TV-Z]{16}$/.test(receipt.publicReference || '') ? receipt.publicReference : '—';
  const date = Number.isFinite(Date.parse(receipt.createdAt))
    ? new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(receipt.createdAt))
    : '—';
  return [
    reversed ? 'إيصال استرجاع رصيد افتراضي' : 'إيصال تسليم رصيد افتراضي',
    `المرجع: ${reference}`,
    `المستلم: ${recipientName} · ID ${publicId}`,
    `القيمة: ${formatAmount(receipt.amount)} ${currencyLabel(receipt.currency)}`,
    `${reversed ? 'تاريخ العملية الأصلية' : 'التاريخ'}: ${date}`,
    ...(reversed && receipt.reversedAt ? [`تاريخ الاسترجاع: ${new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(receipt.reversedAt))}`] : []),
    '',
    reversed
      ? 'هذا الإيصال يؤكد استرجاع الرصيد الافتراضي المرتبط بالعملية الأصلية.'
      : 'هذا الإيصال يؤكد تسليم الرصيد الافتراضي فقط، ولا يثبت استلام دفعة مالية خارجية.',
  ].join('\n');
}

export function createReceiptImageDataUrl(receipt: ShareableReceipt, documentRef: Document = document): string {
  const reversed = receipt.status === 'reversed';
  const canvas = documentRef.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const gradient = context.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, '#1d090d');
  gradient.addColorStop(0.55, '#090506');
  gradient.addColorStop(1, '#2a0b12');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#b98a45';
  context.lineWidth = 4;
  roundRect(context, 64, 64, 952, 1222, 44);
  context.stroke();
  context.textAlign = 'center';
  context.direction = 'rtl';
  context.fillStyle = '#e8c887';
  context.font = '700 48px system-ui';
  context.fillText('بوابة الوكيل المعتمد', 540, 170);
  context.fillStyle = '#fff3d4';
  context.font = '800 76px system-ui';
  context.fillText(reversed ? 'تم استرجاع الرصيد' : 'تم تسليم الرصيد', 540, 310);
  context.fillStyle = '#d3aa66';
  context.font = '600 36px system-ui';
  context.fillText(currencyLabel(receipt.currency), 540, 420);
  context.fillStyle = '#fff7e5';
  context.font = '800 112px system-ui';
  context.fillText(formatAmount(receipt.amount), 540, 550);
  context.fillStyle = '#c9b89e';
  context.font = '500 34px system-ui';
  context.fillText(`${cleanText(receipt.recipientDisplayName || 'مستخدم')} · ID ${receipt.recipientPublicId}`, 540, 690);
  context.fillStyle = '#e8c887';
  context.font = '700 34px ui-monospace, monospace';
  context.fillText(receipt.publicReference || '—', 540, 790);
  context.strokeStyle = 'rgba(185,138,69,.35)';
  context.beginPath();
  context.moveTo(150, 860);
  context.lineTo(930, 860);
  context.stroke();
  context.fillStyle = '#b9aa98';
  context.font = '500 29px system-ui';
  wrapCenteredText(
    context,
    reversed
      ? 'هذا الإيصال يؤكد استرجاع الرصيد الافتراضي المرتبط بالعملية الأصلية.'
      : 'هذا الإيصال يؤكد تسليم الرصيد الافتراضي فقط، ولا يثبت استلام دفعة مالية خارجية.',
    540,
    960,
    760,
    48,
  );
  return canvas.toDataURL('image/png');
}

export function currencyLabel(currency: PortalCurrency): string {
  return currency === 'coins' ? 'عملة ذهبية' : 'ألماسة';
}

export function formatAmount(amount: number): string {
  return Number.isSafeInteger(amount) && amount >= 0 ? new Intl.NumberFormat('en-US').format(amount) : '—';
}

function cleanText(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').trim().slice(0, 40);
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function wrapCenteredText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  lines.forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
}
