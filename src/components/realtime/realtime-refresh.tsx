"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type RealtimeSubscription = {
  table: "bookings" | "notification_outbox" | "support_cases" | "verification_requests";
  filter?: string;
};

type RealtimeRefreshProps = {
  channelName: string;
  subscriptions: RealtimeSubscription[];
  debounceMs?: number;
};

export function RealtimeRefresh({ channelName, subscriptions, debounceMs = 500 }: RealtimeRefreshProps) {
  const router = useRouter();
  const subscriptionKey = JSON.stringify(subscriptions);

  useEffect(() => {
    const parsedSubscriptions = JSON.parse(subscriptionKey) as RealtimeSubscription[];
    if (parsedSubscriptions.length === 0) return;

    const supabase = createClient();
    let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    let isActive = true;
    let channel = supabase.channel(channelName);

    const scheduleRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        if (isActive) router.refresh();
      }, debounceMs);
    };

    for (const subscription of parsedSubscriptions) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: subscription.table,
          ...(subscription.filter ? { filter: subscription.filter } : {}),
        },
        scheduleRefresh,
      );
    }

    channel.subscribe();

    return () => {
      isActive = false;
      if (refreshTimeout) clearTimeout(refreshTimeout);
      void supabase.removeChannel(channel);
    };
  }, [channelName, debounceMs, router, subscriptionKey]);

  return null;
}
