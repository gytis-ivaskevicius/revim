const kDigraphMap = new Map<string, number>();

export const findDigraph = (keys: string): string => {
  const match = kDigraphMap.get(keys);
  if (!match) {
    return "";
  } else {
    return String.fromCodePoint(match);
  }
};
