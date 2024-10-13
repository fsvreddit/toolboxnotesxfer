import { SettingsFormField } from "@devvit/public-api";

export enum AppSetting {
    AutomaticForwardTransfer = "automaticForwardTransfer",
    AutomaticReverseTransfer = "automaticReverseTransfer",
}

export const appSettings: SettingsFormField[] = [
    {
        name: AppSetting.AutomaticForwardTransfer,
        type: "boolean",
        label: "Incrementally transfer new Toolbox notes to mod notes as they are made",
        helpText: "Only takes effect once a full transfer has been done.",
        defaultValue: false,
    },
    {
        name: AppSetting.AutomaticReverseTransfer,
        type: "boolean",
        label: "Incrementally transfer new Reddit mod notes to Toolbox notes as they are made",
        helpText: "Only takes effect once a full transfer has been done.",
        defaultValue: false,
    },
];
