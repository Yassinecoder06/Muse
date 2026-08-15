declare module 'pdf-parse/lib/pdf-parse.js' {
  type PdfResult = { text: string }
  export default function pdf(data: Buffer): Promise<PdfResult>
}
