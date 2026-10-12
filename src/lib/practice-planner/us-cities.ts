// Curated US cities for the sunset check — two to four per state plus DC.
// No geolocation prompt and no external API: the page picks the nearest
// listed city, and sunset there is within a few minutes of a town nearby
// (one degree of longitude is about four minutes).
//
// `utcOffset` is the city's STANDARD offset and `dst` whether it observes US
// daylight saving. Both are PER CITY, never per state — about a dozen states
// span two zones (Indiana, Kentucky, Tennessee, Texas at El Paso, the Florida
// panhandle, Idaho, Oregon at Ontario, the Dakotas, Nebraska, Kansas). Arizona (outside the Navajo Nation,
// which is not listed) and Hawaii observe no DST.
//
// Santa Rosa, CA is the mockup's location and the harness's known answers;
// Sacramento, CA is the page default (DEFAULT_CITY_ID).

export type UsCity = {
  id: string;
  name: string;
  /** Two-letter postal code. */
  state: string;
  lat: number;
  lon: number;
  utcOffset: number;
  dst: boolean;
};

export const DEFAULT_CITY_ID = "ca-sacramento";

type Row = [name: string, lat: number, lon: number, utcOffset: number, dst?: boolean];

const BY_STATE: Record<string, Row[]> = {
  AL: [["Birmingham", 33.52, -86.8, -6], ["Mobile", 30.69, -88.04, -6], ["Montgomery", 32.38, -86.3, -6]],
  AK: [["Anchorage", 61.22, -149.9, -9], ["Fairbanks", 64.84, -147.72, -9], ["Juneau", 58.3, -134.42, -9]],
  AZ: [["Flagstaff", 35.2, -111.65, -7, false], ["Phoenix", 33.45, -112.07, -7, false], ["Tucson", 32.22, -110.97, -7, false]],
  AR: [["Fayetteville", 36.06, -94.16, -6], ["Little Rock", 34.75, -92.29, -6]],
  CA: [
    ["Fresno", 36.74, -119.79, -8],
    ["Los Angeles", 34.05, -118.24, -8],
    ["Redding", 40.59, -122.39, -8],
    ["Sacramento", 38.58, -121.49, -8],
    ["San Diego", 32.72, -117.16, -8],
    ["San Francisco", 37.77, -122.42, -8],
    ["San Jose", 37.34, -121.89, -8],
    ["Santa Rosa", 38.44, -122.71, -8],
  ],
  CO: [["Colorado Springs", 38.83, -104.82, -7], ["Denver", 39.74, -104.99, -7], ["Grand Junction", 39.06, -108.55, -7]],
  CT: [["Hartford", 41.76, -72.68, -5], ["New Haven", 41.31, -72.92, -5]],
  DE: [["Dover", 39.16, -75.52, -5], ["Wilmington", 39.74, -75.55, -5]],
  DC: [["Washington", 38.91, -77.04, -5]],
  FL: [
    ["Jacksonville", 30.33, -81.66, -5],
    ["Miami", 25.76, -80.19, -5],
    ["Orlando", 28.54, -81.38, -5],
    ["Pensacola", 30.42, -87.22, -6],
    ["Tampa", 27.95, -82.46, -5],
  ],
  GA: [["Atlanta", 33.75, -84.39, -5], ["Savannah", 32.08, -81.09, -5]],
  HI: [["Hilo", 19.72, -155.08, -10, false], ["Honolulu", 21.31, -157.86, -10, false]],
  ID: [["Boise", 43.62, -116.2, -7], ["Coeur d'Alene", 47.68, -116.78, -8]],
  IL: [["Chicago", 41.88, -87.63, -6], ["Springfield", 39.78, -89.65, -6]],
  IN: [["Evansville", 37.97, -87.57, -6], ["Fort Wayne", 41.08, -85.14, -5], ["Gary", 41.59, -87.35, -6], ["Indianapolis", 39.77, -86.16, -5]],
  IA: [["Cedar Rapids", 41.98, -91.67, -6], ["Des Moines", 41.59, -93.62, -6]],
  KS: [["Goodland", 39.35, -101.71, -7], ["Topeka", 39.05, -95.68, -6], ["Wichita", 37.69, -97.34, -6]],
  KY: [["Bowling Green", 36.99, -86.44, -6], ["Lexington", 38.04, -84.5, -5], ["Louisville", 38.25, -85.76, -5]],
  LA: [["Baton Rouge", 30.45, -91.19, -6], ["New Orleans", 29.95, -90.07, -6], ["Shreveport", 32.53, -93.75, -6]],
  ME: [["Bangor", 44.8, -68.77, -5], ["Portland", 43.66, -70.26, -5]],
  MD: [["Baltimore", 39.29, -76.61, -5], ["Hagerstown", 39.64, -77.72, -5]],
  MA: [["Boston", 42.36, -71.06, -5], ["Springfield", 42.1, -72.59, -5], ["Worcester", 42.26, -71.8, -5]],
  MI: [["Detroit", 42.33, -83.05, -5], ["Grand Rapids", 42.96, -85.67, -5], ["Marquette", 46.54, -87.4, -5]],
  MN: [["Duluth", 46.79, -92.1, -6], ["Minneapolis", 44.98, -93.27, -6]],
  MS: [["Gulfport", 30.37, -89.09, -6], ["Jackson", 32.3, -90.18, -6]],
  MO: [["Kansas City", 39.1, -94.58, -6], ["Springfield", 37.21, -93.29, -6], ["St. Louis", 38.63, -90.2, -6]],
  MT: [["Billings", 45.78, -108.5, -7], ["Missoula", 46.87, -113.99, -7]],
  NE: [["Lincoln", 40.81, -96.7, -6], ["North Platte", 41.12, -100.77, -6], ["Omaha", 41.26, -95.93, -6], ["Scottsbluff", 41.87, -103.67, -7]],
  NV: [["Las Vegas", 36.17, -115.14, -8], ["Reno", 39.53, -119.81, -8]],
  NH: [["Concord", 43.21, -71.54, -5], ["Manchester", 42.99, -71.46, -5]],
  NJ: [["Atlantic City", 39.36, -74.42, -5], ["Newark", 40.74, -74.17, -5], ["Trenton", 40.22, -74.76, -5]],
  NM: [["Albuquerque", 35.08, -106.65, -7], ["Las Cruces", 32.31, -106.78, -7]],
  NY: [["Albany", 42.65, -73.75, -5], ["Buffalo", 42.89, -78.88, -5], ["New York", 40.71, -74.01, -5], ["Syracuse", 43.05, -76.15, -5]],
  NC: [["Asheville", 35.6, -82.55, -5], ["Charlotte", 35.23, -80.84, -5], ["Raleigh", 35.78, -78.64, -5]],
  ND: [["Bismarck", 46.81, -100.78, -6], ["Dickinson", 46.88, -102.79, -7], ["Fargo", 46.88, -96.79, -6]],
  OH: [["Cincinnati", 39.1, -84.51, -5], ["Cleveland", 41.5, -81.69, -5], ["Columbus", 39.96, -83.0, -5]],
  OK: [["Oklahoma City", 35.47, -97.52, -6], ["Tulsa", 36.15, -95.99, -6]],
  OR: [["Bend", 44.06, -121.32, -8], ["Eugene", 44.05, -123.09, -8], ["Ontario", 44.03, -116.96, -7], ["Portland", 45.52, -122.68, -8]],
  PA: [["Harrisburg", 40.27, -76.88, -5], ["Philadelphia", 39.95, -75.17, -5], ["Pittsburgh", 40.44, -80.0, -5]],
  RI: [["Providence", 41.82, -71.41, -5]],
  SC: [["Charleston", 32.78, -79.93, -5], ["Columbia", 34.0, -81.03, -5], ["Greenville", 34.85, -82.4, -5]],
  SD: [["Rapid City", 44.08, -103.23, -7], ["Sioux Falls", 43.54, -96.73, -6]],
  TN: [["Chattanooga", 35.05, -85.31, -5], ["Knoxville", 35.96, -83.92, -5], ["Memphis", 35.15, -90.05, -6], ["Nashville", 36.16, -86.78, -6]],
  TX: [
    ["Austin", 30.27, -97.74, -6],
    ["Dallas", 32.78, -96.8, -6],
    ["El Paso", 31.76, -106.49, -7],
    ["Houston", 29.76, -95.37, -6],
    ["Lubbock", 33.58, -101.86, -6],
    ["San Antonio", 29.42, -98.49, -6],
  ],
  UT: [["Salt Lake City", 40.76, -111.89, -7], ["St. George", 37.1, -113.58, -7]],
  VT: [["Burlington", 44.48, -73.21, -5]],
  VA: [["Richmond", 37.54, -77.44, -5], ["Roanoke", 37.27, -79.94, -5], ["Virginia Beach", 36.85, -75.98, -5]],
  WA: [["Seattle", 47.61, -122.33, -8], ["Spokane", 47.66, -117.43, -8], ["Vancouver", 45.64, -122.66, -8], ["Yakima", 46.6, -120.51, -8]],
  WV: [["Charleston", 38.35, -81.63, -5], ["Morgantown", 39.63, -79.96, -5]],
  WI: [["Green Bay", 44.51, -88.01, -6], ["Madison", 43.07, -89.4, -6], ["Milwaukee", 43.04, -87.91, -6]],
  WY: [["Casper", 42.87, -106.31, -7], ["Cheyenne", 41.14, -104.82, -7]],
};

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// Plain code-unit order, not localeCompare: the lists render on the server
// and in the browser, and locale collation may differ between them.
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const US_CITIES: UsCity[] = Object.entries(BY_STATE).flatMap(([state, rows]) =>
  rows.map(([name, lat, lon, utcOffset, dst = true]) => ({
    id: `${state.toLowerCase()}-${slug(name)}`,
    name,
    state,
    lat,
    lon,
    utcOffset,
    dst,
  })),
);

/** States in name order, each with its cities in name order. */
export const STATES_SORTED: string[] = Object.keys(BY_STATE).sort((a, b) => byText(STATE_NAMES[a], STATE_NAMES[b]));

export function citiesInState(state: string): UsCity[] {
  return US_CITIES.filter((c) => c.state === state).sort((a, b) => byText(a.name, b.name));
}

/** The city for an id; an unknown id falls back to the default city. */
export function cityById(id: string): UsCity {
  return US_CITIES.find((c) => c.id === id) ?? US_CITIES.find((c) => c.id === DEFAULT_CITY_ID)!;
}
