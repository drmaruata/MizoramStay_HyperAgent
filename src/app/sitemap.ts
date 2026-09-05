import type { MetadataRoute } from "next";
import { demoProperties } from "@/features/properties/types";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/stays`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/search`, changeFrequency: "daily", priority: 0.7 },
    ...demoProperties.map(({ slug }) => ({ url: `${baseUrl}/stays/${slug}`, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
