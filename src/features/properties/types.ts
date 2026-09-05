export type PropertyCard = {
  id: string;
  slug: string;
  name: string;
  destination: string;
  destinationSlug: string;
  locality: string | null;
  description: string;
  rate: number;
  currencyCode: string;
  maxGuests: number;
  rating: number;
  reviews: number;
  verification: "Platform verified" | "Documents verified" | "New";
  amenities: string[];
  coverImageUrl: string | null;
  coverImageAlt: string | null;
};

export const demoProperties: PropertyCard[] = [
  { id: "demo-lushai", slug: "lushai-hill-cottage", name: "Lushai Hill Cottage", destination: "Reiek", destinationSlug: "reiek", locality: "Reiek", description: "A quiet cottage above the village, with a warm kitchen and a long valley view.", rate: 2800, currencyCode: "INR", maxGuests: 2, rating: 4.9, reviews: 28, verification: "Platform verified", amenities: ["Breakfast", "Mountain view", "Parking"], coverImageUrl: null, coverImageAlt: null },
  { id: "demo-durtlang", slug: "durtlang-view-house", name: "Durtlang View House", destination: "Aizawl", destinationSlug: "aizawl", locality: "Durtlang", description: "A light-filled family home close to the city, but a world away from its rush.", rate: 3600, currencyCode: "INR", maxGuests: 4, rating: 4.8, reviews: 41, verification: "Documents verified", amenities: ["Wi-Fi", "Hot water", "Family rooms"], coverImageUrl: null, coverImageAlt: null },
  { id: "demo-thenzawl", slug: "thenzawl-forest-cabin", name: "Thenzawl Forest Cabin", destination: "Thenzawl", destinationSlug: "thenzawl", locality: "Thenzawl", description: "An unhurried base for waterfalls, weaving villages and cool forest mornings.", rate: 2400, currencyCode: "INR", maxGuests: 2, rating: 4.7, reviews: 13, verification: "Platform verified", amenities: ["Breakfast", "Garden", "Parking"], coverImageUrl: null, coverImageAlt: null },
];
