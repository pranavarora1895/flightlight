import type { FlightSearchResult } from "./types";

export interface CombinedItinerary {
  intl: FlightSearchResult;
  outbound?: FlightSearchResult;
  inbound?: FlightSearchResult;
  totalPrice: number;
  totalStops: number;
  domesticPrice: number;
  domesticStops: number;
  domesticEstimated: boolean;
}

/**
 * Pick the cheapest total fare by trying combinations of intl + domestic legs,
 * respecting a shared stop budget across the whole trip.
 */
export function findBestItinerary(
  intlOptions: FlightSearchResult[],
  outboundOptions: FlightSearchResult[],
  inboundOptions: FlightSearchResult[],
  maxStops: number,
  needsDomestic: boolean,
): CombinedItinerary | null {
  let best: CombinedItinerary | null = null;

  for (const intl of intlOptions) {
    if (!needsDomestic) {
      if (intl.stops > maxStops) continue;
      if (!best || intl.price < best.totalPrice) {
        best = {
          intl,
          totalPrice: intl.price,
          totalStops: intl.stops,
          domesticPrice: 0,
          domesticStops: 0,
          domesticEstimated: false,
        };
      }
      continue;
    }

    for (const outbound of outboundOptions) {
      for (const inbound of inboundOptions) {
        const totalStops = intl.stops + outbound.stops + inbound.stops;
        if (totalStops > maxStops) continue;

        const totalPrice = intl.price + outbound.price + inbound.price;
        const domesticEstimated =
          outbound.estimated === true || inbound.estimated === true;

        if (!best || totalPrice < best.totalPrice) {
          best = {
            intl,
            outbound,
            inbound,
            totalPrice,
            totalStops,
            domesticPrice: outbound.price + inbound.price,
            domesticStops: outbound.stops + inbound.stops,
            domesticEstimated,
          };
        }
      }
    }
  }

  return best;
}
