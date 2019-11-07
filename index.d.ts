export interface IDetectedMap {
    encoding: string,
    confidence: number
}
export function detect(buffer: Buffer, options?: { minimumThreshold: number }): IDetectedMap;

export const Constants: {
    MINIMUM_THRESHOLD: number,
}

export function enableDebug(): void;