export declare const readToml: (path: string) => any;
export type TomlCreator<T> = (config: any, option: {
    tomlPath: string;
    creatorOpiton?: ReadCreatorOpiton;
    createFromToml: (tomlPath: string, option?: ReadCreatorOpiton) => Promise<unknown>;
    createFromTomlList: (tomlPath: string, option?: ReadCreatorOpiton) => Promise<unknown[]>;
}) => Promise<T>;
type ReadCreatorOpiton = {
    root?: string;
    getCreatorByKey?: (key: string) => TomlCreator<any> | undefined;
};
export declare const createFromToml: <T>(tomlPath: string, option?: ReadCreatorOpiton, targetToml?: any) => Promise<T>;
export declare const createFromTomlList: <T>(tomlPath: string, option?: ReadCreatorOpiton) => Promise<T[]>;
export {};
