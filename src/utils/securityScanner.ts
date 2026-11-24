import { CADFormat, SecurityScanReport } from '../types/cad';

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB limit for static webspace resilience

// Executable and dangerous magic byte signatures
const FORBIDDEN_SIGNATURES: { name: string; bytes: number[] }[] = [
  { name: 'PE/MZ Executable (.exe/.dll)', bytes: [0x4d, 0x5a] },
  { name: 'ELF Binary', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: 'Mach-O Binary (32-bit)', bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { name: 'Mach-O Binary (64-bit)', bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { name: 'Mach-O Reverse', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { name: 'Shebang Shell Script (#!)', bytes: [0x23, 0x21] },
];

// Suspicious script/injection patterns in text CAD files (.scad, ASCII .stl, .step)
const SCRIPT_INJECTION_PATTERNS: RegExp[] = [
  /<script\b[^>]*>/i,
  /javascript\s*:/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bdocument\.cookie\b/i,
  /\bwindow\.location\b/i,
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/i,
  /<\?php/i,
  /\bimport\s+os\b/i,
  /\bsubprocess\.Popen\b/i,
  /\b__import__\s*\(/i,
];

export function detectExtensionFormat(fileName: string): CADFormat | 'unknown' {
  const clean = fileName.trim().toLowerCase();
  if (clean.endsWith('.scad')) return 'scad';
  if (clean.endsWith('.stl')) return 'stl';
  if (clean.endsWith('.step') || clean.endsWith('.stp')) return 'step';
  return 'unknown';
}

export function computeQuickHashPreview(bytes: Uint8Array): string {
  // Fast deterministic FNV-1a 64-bit style hex preview for UI verification
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    const ch = bytes[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function sanitizeUserText(input: string, maxLength = 500): string {
  return input
    .replace(/<[^>]*>?/gm, '') // Strip HTML tags
    .replace(/javascript:/gi, '')
    .trim()
    .slice(0, maxLength);
}

export function validateCADUpload(
  fileName: string,
  buffer: ArrayBuffer | Uint8Array,
  textPreview?: string
): SecurityScanReport {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const detectedFormat = detectExtensionFormat(fileName);
  const extensionAllowed = detectedFormat !== 'unknown';
  const sizeWithinQuota = bytes.byteLength > 0 && bytes.byteLength <= MAX_UPLOAD_SIZE_BYTES;

  // 1. Check forbidden executable signatures
  let noExecutableSignatures = true;
  let matchedExecutable = '';
  for (const sig of FORBIDDEN_SIGNATURES) {
    if (bytes.length >= sig.bytes.length) {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (bytes[i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        noExecutableSignatures = false;
        matchedExecutable = sig.name;
        break;
      }
    }
  }

  // Decode first 64KB as text for text-based inspection
  const sampleLength = Math.min(bytes.length, 65536);
  let sampleText = textPreview ?? '';
  if (!sampleText && sampleLength > 0) {
    try {
      sampleText = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, sampleLength));
    } catch {
      sampleText = '';
    }
  }

  // 2. Check script injection patterns
  let noScriptInjection = true;
  for (const regex of SCRIPT_INJECTION_PATTERNS) {
    if (regex.test(sampleText)) {
      noScriptInjection = false;
      break;
    }
  }

  // 3. Validate format-specific magic bytes or structural syntax
  let magicBytesValid = false;
  if (detectedFormat === 'stl') {
    const trimmed = sampleText.trimStart();
    if (trimmed.toLowerCase().startsWith('solid')) {
      magicBytesValid = trimmed.toLowerCase().includes('facet') || trimmed.toLowerCase().includes('vertex');
    } else if (bytes.byteLength >= 84) {
      // Binary STL: 80-byte header + uint32 triangle count + 50 bytes per triangle
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const triCount = view.getUint32(80, true);
      const expectedLength = 84 + triCount * 50;
      // Allow exact match or reasonable binary STL bounds
      magicBytesValid = expectedLength === bytes.byteLength || (triCount > 0 && triCount < 2_000_000 && bytes.byteLength >= 84);
    }
  } else if (detectedFormat === 'step') {
    const upper = sampleText.toUpperCase();
    magicBytesValid = upper.includes('ISO-10303-21') || upper.includes('HEADER;') || upper.includes('DATA;');
  } else if (detectedFormat === 'scad') {
    // OpenSCAD must be valid UTF-8 text without null bytes and contain OpenSCAD syntax/primitives
    let hasNullBytes = false;
    for (let i = 0; i < Math.min(bytes.length, 2048); i++) {
      if (bytes[i] === 0) {
        hasNullBytes = true;
        break;
      }
    }
    const hasScadKeywords =
      /(?:\b(cube|cylinder|sphere|polyhedron|square|circle|polygon|union|difference|intersection|hull|minkowski|translate|rotate|scale|mirror|multmatrix|color|resize|offset|linear_extrude|rotate_extrude|projection|surface|text|module|function|for|if|let|include|use|import|echo)\b|\$(fn|fa|fs|t|vpr|vpt|vpd)\b)/i.test(
        sampleText
      );
    // Pure configuration/parameter .scad files (e.g. config.scad) often contain only variable assignments
    const hasScadAssignment = /^[ \t]*\$?[a-zA-Z_][a-zA-Z0-9_]*[ \t]*=[^=]/m.test(sampleText);
    magicBytesValid = !hasNullBytes && (hasScadKeywords || hasScadAssignment);
  }

  const passed =
    extensionAllowed &&
    sizeWithinQuota &&
    noExecutableSignatures &&
    noScriptInjection &&
    magicBytesValid;

  let threatSummary = 'Datei verifiziert: Keine ausführbaren Signaturen oder Skript-Injektionen erkannt.';
  if (!extensionAllowed) {
    threatSummary = 'Blockiert: Dateierweiterung nicht erlaubt (nur .scad, .stl, .step/.stp zugelassen).';
  } else if (!noExecutableSignatures) {
    threatSummary = `Sicherheits-Alarm: Binäre ausführbare Signatur erkannt (${matchedExecutable}). Ausführung verhindert.`;
  } else if (!noScriptInjection) {
    threatSummary = 'Sicherheits-Alarm: Verdächtiger Skript-/Injection-Code im CAD-Quelltext blockiert.';
  } else if (!sizeWithinQuota) {
    threatSummary = 'Blockiert: Dateigröße außerhalb des sicheren Speicherkontingents (max. 25 MB).';
  } else if (!magicBytesValid) {
    threatSummary = `Blockiert: Dateiheader entspricht keiner gültigen ${detectedFormat.toUpperCase()}-Spezifikation.`;
  }

  return {
    passed,
    fileName: sanitizeUserText(fileName, 120),
    fileSizeBytes: bytes.byteLength,
    detectedFormat,
    sha256Preview: computeQuickHashPreview(bytes),
    checks: {
      extensionAllowed,
      magicBytesValid,
      noExecutableSignatures,
      noScriptInjection,
      sizeWithinQuota,
    },
    threatSummary,
    timestamp: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}
