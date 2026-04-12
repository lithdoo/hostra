import * as fs from 'fs';
import path from 'path';
import toml from 'toml';


export const readToml = (path: string) => {
    const tomlText = fs.readFileSync(path, 'utf8');
    return toml.parse(tomlText);
}

export type TomlCreator<T> = (config: any, option: {
    tomlPath: string,
    creatorOpiton?: ReadCreatorOpiton,
    createFromToml: (
        tomlPath: string,
        option?: ReadCreatorOpiton,
    ) => Promise<unknown>,
    createFromTomlList: (
        tomlPath: string,
        option?: ReadCreatorOpiton,
    ) => Promise<unknown[]>,
}) => Promise<T>


type ReadCreatorOpiton = {
    root?: string,
    getCreatorByKey?: (key: string) => TomlCreator<any> | undefined,
}


export const createFromToml = async <T>(
    tomlPath: string,
    option?: ReadCreatorOpiton,
    targetToml?: any,
) => {
    const toml = targetToml || readToml(tomlPath);
    const creatorKey = toml.creator;
    const config = toml.config;


    let creator: TomlCreator<T> | undefined = await option?.getCreatorByKey?.(creatorKey);
    if (!creator) {
        const creatorPath = creatorKey.startsWith('./')
            ? path.resolve(path.dirname(tomlPath), creatorKey)
            : path.join(option?.root || process.cwd(), creatorKey)
        // 从 ts 文件中获取
        const { default: creatorFn } = await import(creatorPath)
        creator = creatorFn as TomlCreator<T>
    }

    if (!creator) {
        throw new Error(`Creator not found for key: ${creatorKey} in toml from ${tomlPath}`);
    }

    return creator(config, {
        tomlPath,
        creatorOpiton: option,
        createFromToml: (tomlNextPath: string, nextOption?: ReadCreatorOpiton): Promise<unknown> => {
            const currentOption = nextOption ?? option;

            const next = tomlNextPath.startsWith('./')
                ? path.resolve(path.dirname(tomlPath), tomlNextPath)
                : path.join(currentOption?.root || process.cwd(), tomlNextPath)
            return createFromToml<any>(next, currentOption);
        },
        createFromTomlList: (tomlNextPath: string, nextOption?: ReadCreatorOpiton) => {
            const currentOption = nextOption ?? option;

            const next = tomlNextPath.startsWith('./')
                ? path.resolve(path.dirname(tomlPath), tomlNextPath)
                : path.join(currentOption?.root || process.cwd(), tomlNextPath)
            return createFromTomlList(next, currentOption);
        },
    });
}


export const createFromTomlList = async <T>(
    tomlPath: string,
    option?: ReadCreatorOpiton,
) => {
    const list = readToml(tomlPath)?.items ?? [];
    return await Promise.all(list.map((item: any) => createFromToml(tomlPath, option, item))) as T[];
}