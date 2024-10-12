import { SettingsFormField } from "@devvit/public-api";

export enum AppSetting {
    AutomaticIncrementalTransfer = "automaticTransfer",
}

export const appSettings: SettingsFormField[] = [
    {
        name: AppSetting.AutomaticIncrementalTransfer,
        type: "boolean",
        label: "Incrementally transfer new Toolbox notes as they are made",
        helpText: "Only takes effect once a full transfer has been done.",
        defaultValue: false,
    },
];
