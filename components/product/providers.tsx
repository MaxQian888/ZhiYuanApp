"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { RemoteDataBridge } from "@/components/product/remote-data-bridge"

export function ProductProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
          mutations: { retry: 0 },
        },
      })
  )
  return (
    <QueryClientProvider client={queryClient}>
      <RemoteDataBridge />
      {children}
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  )
}
