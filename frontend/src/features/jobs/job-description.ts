export const REQUIREMENTS_HEADING = "任职要求";

export function composeJobDescription(description: string, requirements: string): string {
  const desc = description.trim();
  const req = requirements.trim();
  if (desc && req) return `${desc}\n\n${REQUIREMENTS_HEADING}\n${req}`;
  if (req) return `${REQUIREMENTS_HEADING}\n${req}`;
  return desc;
}

export function splitJobDescription(value: string): { description: string; requirements: string } {
  const text = value.replace(/\r\n/g, "\n").trim();
  const match = text.match(/^(.*?)\n+任职要求\s*\n+([\s\S]*)$/);
  if (!match) return { description: text, requirements: "" };
  return { description: match[1].trim(), requirements: match[2].trim() };
}
