/**
 * Barcode Scanner
 * Camera-based Code128 barcode scanning using html5-qrcode
 */

const BarcodeScanner = (() => {
  'use strict';

  let html5QrCode = null;
  let isScanning = false;
  let isPaused = false;
  let onSuccessCallback = null;
  let onErrorCallback = null;

  /**
   * Initialize scanner with camera
   * @param {HTMLElement} containerElement - Element to render scanner in
   * @param {Function} onSuccess - Callback when barcode detected (receives decoded text)
   * @param {Function} onError - Optional error callback
   * @returns {Promise<void>}
   */
  async function startScanner(containerElement, onSuccess, onError) {
    if (isScanning) {
      console.warn('Scanner already running');
      return;
    }

    if (!containerElement) {
      throw new Error('Container element is required');
    }

    onSuccessCallback = onSuccess;
    onErrorCallback = onError || console.error;

    try {
      html5QrCode = new Html5Qrcode(containerElement.id);

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 150 },
        aspectRatio: 1.777778, // 16:9
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E
        ]
      };

      await html5QrCode.start(
        { facingMode: "environment" }, // Use rear camera
        config,
        onScanSuccess,
        onScanFailure
      );

      isScanning = true;
    } catch (error) {
      console.error('Failed to start scanner:', error);
      if (onErrorCallback) {
        onErrorCallback(error);
      }
      throw error;
    }
  }

  /**
   * Stop scanner and release camera
   * @returns {Promise<void>}
   */
  async function stopScanner() {
    if (!isScanning || !html5QrCode) {
      return;
    }

    try {
      await html5QrCode.stop();
      html5QrCode.clear();
      isScanning = false;
      isPaused = false;
      html5QrCode = null;
    } catch (error) {
      console.error('Failed to stop scanner:', error);
    }
  }

  /**
   * Pause scanning (camera stays on but ignores scans)
   */
  function pauseScanning() {
    isPaused = true;
  }

  /**
   * Resume scanning
   */
  function resumeScanning() {
    isPaused = false;
  }

  /**
   * Check if scanning is paused
   * @returns {boolean}
   */
  function isPausedStatus() {
    return isPaused;
  }

  /**
   * Internal success handler
   */
  function onScanSuccess(decodedText, decodedResult) {
    // Ignore scans while paused
    if (isPaused) {
      return;
    }
    
    console.log('Barcode scanned:', decodedText, decodedResult);
    
    // Pause scanning to show quantity input
    isPaused = true;
    
    if (onSuccessCallback) {
      onSuccessCallback(decodedText, decodedResult);
    }
  }

  /**
   * Internal failure handler (silent - most frames won't have a barcode)
   */
  function onScanFailure(error) {
    // Don't log every frame failure - too verbose
    // Only log if it's an actual error, not just "no barcode found"
    if (error && !error.includes('No MultiFormat Readers')) {
      // console.debug('Scan frame:', error);
    }
  }

  /**
   * Check if camera is available
   * @returns {Promise<boolean>}
   */
  async function isCameraAvailable() {
    try {
      const devices = await Html5Qrcode.getCameras();
      return devices && devices.length > 0;
    } catch (error) {
      console.error('Failed to check camera availability:', error);
      return false;
    }
  }

  /**
   * Get list of available cameras
   * @returns {Promise<Array>}
   */
  async function getCameras() {
    try {
      return await Html5Qrcode.getCameras();
    } catch (error) {
      console.error('Failed to get cameras:', error);
      return [];
    }
  }

  /**
   * Check if scanner is currently running
   * @returns {boolean}
   */
  function isRunning() {
    return isScanning;
  }

  // Public API
  return {
    startScanner,
    stopScanner,
    pauseScanning,
    resumeScanning,
    isPausedStatus,
    isCameraAvailable,
    getCameras,
    isRunning
  };
})();
