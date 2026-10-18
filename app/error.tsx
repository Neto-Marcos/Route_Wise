"use client";

import { ErrorScreen } from "@/components/error-screen";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen code="unexpected" reset={reset} reference={error.digest} />;
}
