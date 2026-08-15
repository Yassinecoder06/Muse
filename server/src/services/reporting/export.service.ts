import PDFDocument from 'pdfkit'
import { Document, Packer, Paragraph, TextRun } from 'docx'
const plain = (html: string) => html.replace(/<\/p>|<\/h[12]>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
export const exports = {
  html(title: string, content: string) { return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{max-width:760px;margin:48px auto;font:16px/1.65 Georgia,serif;color:#222}h1,h2{font-family:Arial,sans-serif}a{color:#276749}</style></head><body><h1>${title}</h1>${content}</body></html>` },
  async docx(title: string, content: string) { return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32 })] }), ...plain(content).split(/\n+/).filter(Boolean).map(text => new Paragraph(text))] }] })) },
  pdf(title: string, content: string) { const document = new PDFDocument({ margin: 54 }); document.fontSize(22).text(title); document.moveDown(); document.fontSize(11).text(plain(content), { lineGap: 5 }); document.end(); return document }
}
