/** THE ONLY dsh import seam. Keep empty/stub until ds-harness is wired. */
export type DshPorts = {
  available: boolean;
};

export function dshPorts(): DshPorts {
  return { available: false };
}
