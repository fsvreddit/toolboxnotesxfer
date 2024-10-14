import { SettingsFormField } from "@devvit/public-api";
import { LAST_SYNC_COMPLETED } from "./constants.js";

export enum AppSetting {
    AutomaticForwardTransfer = "automaticForwardTransfer",
    AutomaticReverseTransfer = "automaticReverseTransfer",
}

export const appSettings: SettingsFormField[] = [
    {
        type: "group",
        label: "Synchronisation Options",
        helpText: "If you intend to turn on synchronisation AND do a bulk transfer, it is best to start the bulk transfer as early as possible",
        fields: [
            {
                name: AppSetting.AutomaticForwardTransfer,
                type: "boolean",
                label: "Incrementally transfer new Toolbox notes to mod notes as they are made",
                defaultValue: false,
                onValidate: async ({ value }, context) => {
                    const redisKey = "lastForwardTransferSetting";
                    const lastValueVal = await context.redis.get(redisKey);
                    const lastValue = lastValueVal === "true";

                    if (!lastValue && value) {
                        await context.redis.set(LAST_SYNC_COMPLETED, new Date().getTime().toString());
                    }

                    await context.redis.set(redisKey, JSON.stringify(value));
                },
            },
            {
                name: AppSetting.AutomaticReverseTransfer,
                type: "boolean",
                label: "Incrementally transfer new Reddit mod notes to Toolbox notes as they are made",
                defaultValue: false,
            },
        ],
    },

];
