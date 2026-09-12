function extractCityAndUf(cityRaw, ufRaw) {
  let city = (cityRaw || '').trim();
  let uf = (ufRaw || '').trim().toUpperCase();

  if (!uf && city) {
    // Check patterns like "Campinas - SP", "Campinas/SP", "Campinas, SP"
    const match = city.match(/^(.*?)\s*[-/,\s]\s*([A-Za-z]{2})$/);
    if (match) {
      city = match[1].trim();
      uf = match[2].toUpperCase();
    }
  }

  return { city, uf: uf || undefined };
}

console.log(extractCityAndUf('Campinas - SP', ''));
console.log(extractCityAndUf('São Paulo / SP', ''));
console.log(extractCityAndUf('Jundiaí', 'SP'));
console.log(extractCityAndUf('Americana, sp', ''));
console.log(extractCityAndUf('Santos', ''));
