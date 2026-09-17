/**
 * Shared formatting utilities for Brazilian transport & logistics data.
 * Adheres to Mercosul plate standards, ANATEL Brazilian phone formats, and SEFAZ DANFE 44-digit keys.
 */

/**
 * Formats a Brazilian vehicle license plate into uppercase Mercosul (ABC1D23) or standard (ABC-1234).
 */
export function formatMercosulPlate(value: string): string {
  if (!value) return "";
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  // If user is entering old pattern (3 letters + 4 digits), we can show ABC-1234 when 7 chars
  if (/^[A-Z]{3}[0-9]{4}$/.test(cleaned)) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  }
  // Mercosul: 3 letters + 1 digit + 1 letter + 2 digits (e.g. BRA2E19)
  return cleaned;
}

/**
 * Formats a Brazilian telephone number progressively as the user types:
 * (XX) XXXXX-XXXX (11 digits, mobile) or (XX) XXXX-XXXX (10 digits, landline).
 */
export function formatBRPhone(value: string): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

/**
 * Formats a 44-digit SEFAZ DANFE access key into 4-digit readable clusters:
 * XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX
 */
export function formatDANFEKey(value: string): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "").slice(0, 44);
  const parts: string[] = [];
  for (let i = 0; i < digits.length; i += 4) {
    parts.push(digits.slice(i, i + 4));
  }
  return parts.join(" ");
}

/**
 * Unformats / cleans a formatted DANFE key back to plain 44 digits.
 */
export function cleanDANFEKey(value: string): string {
  return (value || "").replace(/\D/g, "").slice(0, 44);
}

/**
 * Standard Brazilian currency formatting (R$ X.XXX,XX).
 */
export function formatCurrencyBR(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Formats a date to Brazilian standard DD/MM/YYYY.
 */
export function formatDateBR(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return "-";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("pt-BR");
  } catch {
    return "-";
  }
}

/**
 * Formats date and time to Brazilian standard DD/MM/YYYY às HH:mm.
 */
export function formatDateTimeBR(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return "-";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "-";
    const date = d.toLocaleDateString("pt-BR");
    const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `${date} às ${time}`;
  } catch {
    return "-";
  }
}

/**
 * Formats minutes into human-readable duration (e.g. 1h 45m or 35m).
 */
export function formatDurationMinutes(totalMinutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(totalMinutes ?? 0)));
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}