"use client";

import { ErrorScreen } from "@/components/error-screen";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="pt-BR"><body><ErrorScreen code="500" reset={reset} reference={error.digest} /></body></html>;
}
