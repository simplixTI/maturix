export function resolveSpintax(text: string): string {
  let result = text;
  let safety = 0;

  while (result.includes('{') && safety < 50) {
    result = result.replace(/\{([^{}]+)\}/g, (_match, group: string) => {
      const options = group.split('|');
      return options[Math.floor(Math.random() * options.length)];
    });
    safety++;
  }

  return result;
}

export function previewSpintax(text: string, count: number = 5): string[] {
  return Array.from({ length: count }, () => resolveSpintax(text));
}

export function countVariations(text: string): number {
  let count = 1;
  const matches = text.match(/\{([^{}]+)\}/g);
  if (!matches) return 1;

  for (const match of matches) {
    const options = match.slice(1, -1).split('|').length;
    count *= options;
  }

  return count;
}
