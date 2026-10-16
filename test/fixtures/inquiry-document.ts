export function inquiryPdf(withText: boolean): Buffer {
  const stream = withText
    ? 'BT /F1 12 Tf 72 720 Td (First line) Tj 0 -18 Td (Second line) Tj ET'
    : '72 700 100 50 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let data = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(data));
    data += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(data);
  data += 'xref\n0 6\n0000000000 65535 f \n';
  data += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  data += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(data);
}

export function extractedWord(body: string, textboxes = '') {
  return {
    getBody: () => body,
    getTextboxes: () => textboxes,
    getFootnotes: () => '',
    getHeaders: () => '',
    getFooters: () => '',
    getAnnotations: () => '',
    getEndnotes: () => '',
  };
}
