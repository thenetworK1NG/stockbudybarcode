/**
 * Barcode Utilities
 * Shared functions for generating Code128 barcodes
 */

const BarcodeUtils = (() => {
  'use strict';

  /**
   * Generate a Code128 barcode on a canvas element
   * @param {string} value - The value to encode (item ID or auth key)
   * @param {HTMLCanvasElement} canvas - Canvas element to draw on
   * @param {Object} options - Barcode options
   * @returns {boolean} Success status
   */
  function generateBarcode(value, canvas, options = {}) {
    try {
      const defaults = {
        format: 'CODE128',
        width: 2,
        height: 80,
        displayValue: true,
        fontSize: 14,
        font: 'monospace',
        textAlign: 'center',
        textPosition: 'bottom',
        background: '#ffffff',
        lineColor: '#000000',
        margin: 10
      };

      const config = { ...defaults, ...options };

      JsBarcode(canvas, value, config);
      return true;
    } catch (error) {
      console.error('Barcode generation error:', error);
      return false;
    }
  }

  /**
   * Generate barcode and return as Data URL
   * @param {string} value - The value to encode
   * @param {Object} options - Barcode options
   * @returns {string|null} Data URL or null on error
   */
  function generateBarcodeDataURL(value, options = {}) {
    const canvas = document.createElement('canvas');
    const success = generateBarcode(value, canvas, options);
    return success ? canvas.toDataURL('image/png') : null;
  }

  /**
   * Download barcode as PNG image
   * @param {string} value - The value to encode
   * @param {string} filename - Filename for download
   * @param {Object} options - Barcode options
   */
  function downloadBarcode(value, filename, options = {}) {
    const dataURL = generateBarcodeDataURL(value, options);
    if (!dataURL) {
      console.error('Failed to generate barcode for download');
      return;
    }

    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename || `barcode-${value}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Validate if a string is suitable for Code128 encoding
   * @param {string} value - Value to validate
   * @returns {boolean} Valid or not
   */
  function isValidCode128(value) {
    if (!value || typeof value !== 'string') return false;
    // Code128 supports ASCII 0-127
    return /^[\x00-\x7F]+$/.test(value);
  }

  /**
   * Create a printable barcode label HTML
   * @param {string} value - Barcode value
   * @param {string} label - Human-readable label
   * @param {Object} options - Barcode options
   * @returns {string} HTML string
   */
  function createLabelHTML(value, label, options = {}) {
    const dataURL = generateBarcodeDataURL(value, options);
    if (!dataURL) return '';

    return `
      <div class="barcode-label" style="
        width: 3in;
        height: 1in;
        padding: 0.1in;
        background: white;
        border: 1px solid #ddd;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        page-break-inside: avoid;
      ">
        <div style="font-size: 10px; font-weight: 600; margin-bottom: 4px; text-align: center;">
          ${escapeHTML(label)}
        </div>
        <img src="${dataURL}" style="max-width: 100%; height: auto;" alt="Barcode">
      </div>
    `;
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Generate multiple barcodes for printing (Avery 5160 layout)
   * @param {Array} items - Array of {value, label} objects
   * @returns {string} HTML for print sheet
   */
  function generatePrintSheet(items) {
    if (!Array.isArray(items) || items.length === 0) return '';

    const labels = items.map(item => 
      createLabelHTML(item.value, item.label)
    ).join('\n');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Barcode Labels</title>
        <style>
          @page {
            size: letter;
            margin: 0.5in 0.1875in;
          }
          body {
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
          }
          .label-sheet {
            width: 8.5in;
            display: grid;
            grid-template-columns: repeat(3, 2.625in);
            grid-auto-rows: 1in;
            gap: 0;
            padding: 0;
          }
          .barcode-label {
            width: 2.625in;
            height: 1in;
            padding: 0.1in;
            background: white;
            border: 1px dashed #ccc;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
          }
          @media print {
            .barcode-label {
              border: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="label-sheet">
          ${labels}
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Open print sheet in new window
   * @param {Array} items - Array of {value, label} objects
   */
  function printLabels(items) {
    const html = generatePrintSheet(items);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  }

  // Public API
  return {
    generateBarcode,
    generateBarcodeDataURL,
    downloadBarcode,
    isValidCode128,
    createLabelHTML,
    generatePrintSheet,
    printLabels
  };
})();
