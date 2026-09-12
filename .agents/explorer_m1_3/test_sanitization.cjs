function sanitizeBrazilianNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') {
    return isNaN(value) || !isFinite(value) ? fallback : value;
  }

  let str = String(value).trim();
  if (!str) return fallback;

  // 1. Remove known unit suffixes that contain digits (like m3, m^3, cm3)
  str = str.replace(/(?:m\^?3|cm\^?3|dm\^?3|m³|cbm)/gi, '');

  // 2. Remove non-numeric units / text (kg, cxs, etc.)
  str = str.replace(/(?:kgs?|quilos?|kilos?|tons?|cxs?|caixas?|volumes?|vols?|itens?|unid(?:ades?)?|un|pe[çc]as?)/gi, '');

  // 3. Remove currency or other non-digit symbols except . , + -
  str = str.replace(/[^\d.,+-]/gi, '').trim();
  if (!str) return fallback;

  const hasComma = str.includes(',');
  const hasDot = str.includes('.');

  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) {
      // Brazilian format: 1.250,50 -> remove dots, replace comma with dot
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,250.50 -> remove commas
      str = str.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Only comma: 1250,50 or 0,45 -> replace comma with dot
    str = str.replace(',', '.');
  } else if (hasDot) {
    // Multiple dots: 1.000.000 -> remove dots
    const dots = str.split('.').length - 1;
    if (dots > 1) {
      str = str.replace(/\./g, '');
    }
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed;
}

// Test cases
const tests = [
  ['1.250,50', 1250.50],
  ['0,45 m³', 0.45],
  ['140 kg', 140.0],
  ['2,10 m3', 2.10],
  ['2,10m3', 2.10],
  ['0.85m^3', 0.85],
  ['350,00', 350.0],
  ['1,250.50', 1250.50],
  ['1.500.000,75', 1500000.75],
  ['45 cx', 45],
  ['45cxs', 45],
  ['R$ 1.234,56', 1234.56],
  ['N/A', 0],
  ['', 0],
  ['-15,5', -15.5],
  [123.45, 123.45],
];

for (const [input, expected] of tests) {
  const result = sanitizeBrazilianNumber(input);
  const ok = Math.abs(result - expected) < 0.0001;
  console.log(`${ok ? 'PASS' : 'FAIL'}: "${input}" => ${result} (expected ${expected})`);
}
