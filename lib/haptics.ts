/**
 * lib/haptics.ts
 * Feedback tátil nativo (Haptic Feedback) via Vibration API para dispositivos móveis
 */

export const haptics = {
  /** Toque sutil de clique / seleção */
  tap() {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(12);
      } catch {}
    }
  },

  /** Sucesso / Conclusão (dois pulsos rápidos e satisfatórios) */
  success() {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([20, 40, 30]);
      } catch {}
    }
  },

  /** Alerta / Atenção (pulso médio) */
  warning() {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([40, 60, 40]);
      } catch {}
    }
  },

  /** Erro ou bloqueio (pulso forte e longo) */
  error() {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([60, 50, 60, 50, 80]);
      } catch {}
    }
  },

  /** Bipagem / Leitura de código de barras ou NF */
  beep() {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([18, 25, 18]);
      } catch {}
    }
  },
};
