/**
 * DataLift - DocumentProcessor Unit Tests
 *
 * Tests the core parsing logic for receipts, invoices, bills,
 * contracts, and generic documents.
 */

import { DocumentProcessor } from '../utils/DocumentProcessor';
import { DocumentType } from '../types';

// Mock the NativeModules
jest.mock('react-native', () => ({
  NativeModules: {
    DataLift: {
      classifyDocument: jest.fn(),
      extractTextNative: jest.fn(),
      extractPDFPages: jest.fn(),
    },
  },
}));

describe('DocumentProcessor', () => {
  let processor: DocumentProcessor;

  beforeEach(() => {
    processor = new DocumentProcessor({
      language: 'eng',
      enableDebug: false,
    });
  });

  // ─── Receipt Parsing ────────────────────────────────────────────

  describe('Receipt Parsing', () => {
    it('should extract receipt total amount', () => {
      const testText = `
Walmart Supercenter
2024-02-11 14:35

Milk                    4.99
Bread                   3.49

Subtotal               8.48
Tax                    0.68
Total                  9.16
      `.trim();

      const result = processor.parseReceipt(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.totalAmount).toBe(9.16);
    });

    it('should extract merchant name', () => {
      const testText = `Walmart Supercenter
123 Main Street
Date: 01/15/2024
Total: $25.50`;

      const result = processor.parseReceipt(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.merchantName).toBe('Walmart Supercenter');
    });

    it('should extract transaction date', () => {
      const testText = `Store Name
Date: 2024-02-11
Item 1    5.99
Total     5.99`;

      const result = processor.parseReceipt(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.transactionDate).toBe('2024-02-11');
    });

    it('should extract transaction date in MM/DD/YYYY format', () => {
      const testText = `Store Name
02/11/2024 14:30
Item 1    5.99
Total     5.99`;

      const result = processor.parseReceipt(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.transactionDate).toBe('02/11/2024');
    });

    it('should extract subtotal and tax', () => {
      const testText = `Store Name
Item A    10.00
Subtotal  10.00
Tax       0.80
Total     10.80`;

      const result = processor.parseReceipt(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.subtotal).toBe(10.0);
      expect(result.tax).toBe(0.8);
      expect(result.totalAmount).toBe(10.8);
    });

    it('should extract line items with prices', () => {
      const testText = `Store Name
Coffee              4.50
Sandwich            8.99
Subtotal           13.49
Tax                 1.08
Total              14.57`;

      const result = processor.parseReceipt(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.items).toBeDefined();
      expect(result.items!.length).toBeGreaterThanOrEqual(2);

      const coffeeItem = result.items!.find((i) =>
        i.name.toLowerCase().includes('coffee')
      );
      expect(coffeeItem).toBeDefined();
      expect(coffeeItem!.totalPrice).toBe(4.5);
    });

    it('should handle missing receipt data gracefully', () => {
      const testText = 'Some random text without receipt data';

      const result = processor.parseReceipt(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.totalAmount).toBe(0);
      expect(result.items).toEqual([]);
    });

    it('should extract time from receipt', () => {
      const testText = `Store Name
02/11/2024 2:35 PM
Item    5.99
Total   5.99`;

      const result = processor.parseReceipt(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.transactionTime).toBeDefined();
    });
  });

  // ─── Invoice Parsing ────────────────────────────────────────────

  describe('Invoice Parsing', () => {
    it('should extract invoice number', () => {
      const testText = `
Invoice #INV-2024-00156
Issue Date: 2024-02-01
Due Date: 2024-03-01
Total Due: $1250.00
      `.trim();

      const result = processor.parseInvoice(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.invoiceNumber).toContain('INV-2024-00156');
    });

    it('should extract issue and due dates', () => {
      const testText = `
Invoice #INV-001
Issue Date: 2024-02-01
Due Date: 2024-03-01
Amount Due: $500.00
      `.trim();

      const result = processor.parseInvoice(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.issueDate).toContain('2024-02-01');
      expect(result.dueDate).toContain('2024-03-01');
    });

    it('should extract total amount from invoice', () => {
      const testText = `Invoice INV-100
Date: 2024-01-15
Grand Total: $2500.00`;

      const result = processor.parseInvoice(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.totalAmount).toBe(2500.0);
    });

    it('should parse line items', () => {
      const testText = `Invoice INV-200
Web Design Services 1 $1500.00
Hosting Setup 2 $250.00
Total: $2000.00`;

      const result = processor.parseInvoice(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.lineItems).toBeDefined();
      expect(result.lineItems!.length).toBeGreaterThan(0);
    });

    it('should handle invoice with missing fields', () => {
      const testText = 'Just some text that looks like an invoice';

      const result = processor.parseInvoice(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.invoiceNumber).toBeUndefined();
      expect(result.totalAmount).toBe(0);
      expect(result.lineItems).toEqual([]);
    });
  });

  // ─── Generic Document Parsing ───────────────────────────────────

  describe('Generic Document Parsing', () => {
    it('should extract email addresses', () => {
      const testText =
        'Contact us at support@example.com or sales@example.org for help';

      const result = processor.parseGenericDocument(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.extractedEmails).toContain('support@example.com');
      expect(result.extractedEmails).toContain('sales@example.org');
    });

    it('should extract phone numbers', () => {
      const testText = 'Call us at (555) 123-4567 for more info';

      const result = processor.parseGenericDocument(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.extractedPhones!.length).toBeGreaterThan(0);
    });

    it('should extract URLs', () => {
      const testText =
        'Visit https://example.com or https://test.org for more info';

      const result = processor.parseGenericDocument(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.extractedURLs).toContain('https://example.com');
      expect(result.extractedURLs).toContain('https://test.org');
    });

    it('should create sections from text lines', () => {
      const testText = `First line of text
Second line of text
Third line of text`;

      const result = processor.parseGenericDocument(
        testText.split('\n').filter((l) => l.trim()),
        testText
      );

      expect(result.sections).toBeDefined();
      expect(result.sections!.length).toBe(3);
    });

    it('should handle empty text', () => {
      const testText = '';

      const result = processor.parseGenericDocument([], testText);

      expect(result.extractedEmails).toEqual([]);
      expect(result.extractedPhones).toEqual([]);
      expect(result.extractedURLs).toEqual([]);
      expect(result.sections).toEqual([]);
    });
  });

  // ─── Bill Parsing ───────────────────────────────────────────────

  describe('Bill Parsing', () => {
    it('should extract amount due from bill', () => {
      const testText = `Electric Company
Account Number: ACC-12345
Billing Period: Jan 2024
Amount Due: $145.67
Pay By: 02/15/2024`;

      const result = (processor as any).parseBill(
        testText.split('\n').filter((l: string) => l.trim()),
        testText
      );

      expect(result.totalAmount).toBe(145.67);
    });

    it('should extract dates from bill', () => {
      const testText = `Utility Bill
Statement Date: 2024-01-15
Due Date: 2024-02-15
Total: $89.50`;

      const result = (processor as any).parseBill(
        testText.split('\n').filter((l: string) => l.trim()),
        testText
      );

      expect(result.issueDate).toBe('2024-01-15');
      expect(result.dueDate).toBe('2024-02-15');
    });
  });

  // ─── Contract Parsing ──────────────────────────────────────────

  describe('Contract Parsing', () => {
    it('should extract title from contract', () => {
      const testText = `SERVICE AGREEMENT
Effective Date: 2024-01-01
PARTIES
Company A and Company B`;

      const result = (processor as any).parseContract(
        testText.split('\n').filter((l: string) => l.trim()),
        testText
      );

      expect(result.title).toBe('SERVICE AGREEMENT');
    });

    it('should create sections from contract headings', () => {
      const testText = `CONTRACT TITLE
2024-01-01
TERMS AND CONDITIONS
These are the terms of the agreement.
OBLIGATIONS
Each party shall fulfill their duties.`;

      const result = (processor as any).parseContract(
        testText.split('\n').filter((l: string) => l.trim()),
        testText
      );

      expect(result.sections).toBeDefined();
      expect(result.sections!.length).toBeGreaterThan(0);
    });
  });

  // ─── Heuristic Classification ──────────────────────────────────

  describe('Heuristic Classification', () => {
    it('should classify receipt text correctly', () => {
      const receiptText = `Walmart Store #4567
Receipt
Items purchased today
Milk 4.99
Subtotal 4.99
Tax 0.40
Total 5.39
Thank you for your purchase!
Cash payment`;

      const result = (processor as any).heuristicClassify(receiptText);

      expect(result.type).toBe(DocumentType.RECEIPT);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should classify invoice text correctly', () => {
      const invoiceText = `Invoice #2024-001
Bill to: John Doe
Ship to: 123 Main St
Payment terms: Net 30
Amount due: $1500
Due date: 2024-03-15
Balance due: $1500`;

      const result = (processor as any).heuristicClassify(invoiceText);

      expect(result.type).toBe(DocumentType.INVOICE);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should return generic for ambiguous text', () => {
      const ambiguousText = 'Hello world this is some random text.';

      const result = (processor as any).heuristicClassify(ambiguousText);

      expect(result.type).toBe(DocumentType.GENERIC);
    });
  });

  // ─── Error Handling ─────────────────────────────────────────────

  describe('Error Handling', () => {
    it('should throw on missing image URI', async () => {
      await expect(
        processor.processImage({ uri: '' })
      ).rejects.toThrow('Image URI is required');
    });

    it('should throw on missing PDF URI', async () => {
      await expect(
        processor.processPDF({ uri: '' })
      ).rejects.toThrow('PDF URI is required');
    });
  });
});
