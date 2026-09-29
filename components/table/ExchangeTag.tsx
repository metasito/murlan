import { ChipText, CHIP_NAME_MAX_W, TableChip } from "./chrome";

export function ExchangeTag({ name, scale, testID }: { name: string; scale: number; testID?: string }) {
  return (
    <TableChip scale={scale} lit>
      <ChipText scale={scale} lit maxWidth={CHIP_NAME_MAX_W * 2} testID={testID}>
        {name}
      </ChipText>
    </TableChip>
  );
}
