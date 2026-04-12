"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFromTomlList = exports.createFromToml = exports.readToml = void 0;
const fs = __importStar(require("fs"));
const path_1 = __importDefault(require("path"));
const toml_1 = __importDefault(require("toml"));
const readToml = (path) => {
    const tomlText = fs.readFileSync(path, 'utf8');
    return toml_1.default.parse(tomlText);
};
exports.readToml = readToml;
const createFromToml = async (tomlPath, option, targetToml) => {
    const toml = targetToml || (0, exports.readToml)(tomlPath);
    const creatorKey = toml.creator;
    const config = toml.config;
    let creator = await option?.getCreatorByKey?.(creatorKey);
    if (!creator) {
        const creatorPath = creatorKey.startsWith('./')
            ? path_1.default.resolve(path_1.default.dirname(tomlPath), creatorKey)
            : path_1.default.join(option?.root || process.cwd(), creatorKey);
        // 从 ts 文件中获取
        const { default: creatorFn } = await Promise.resolve(`${creatorPath}`).then(s => __importStar(require(s)));
        creator = creatorFn;
    }
    if (!creator) {
        throw new Error(`Creator not found for key: ${creatorKey} in toml from ${tomlPath}`);
    }
    return creator(config, {
        tomlPath,
        creatorOpiton: option,
        createFromToml: (tomlNextPath, nextOption) => {
            const currentOption = nextOption ?? option;
            const next = tomlNextPath.startsWith('./')
                ? path_1.default.resolve(path_1.default.dirname(tomlPath), tomlNextPath)
                : path_1.default.join(currentOption?.root || process.cwd(), tomlNextPath);
            return (0, exports.createFromToml)(next, currentOption);
        },
        createFromTomlList: (tomlNextPath, nextOption) => {
            const currentOption = nextOption ?? option;
            const next = tomlNextPath.startsWith('./')
                ? path_1.default.resolve(path_1.default.dirname(tomlPath), tomlNextPath)
                : path_1.default.join(currentOption?.root || process.cwd(), tomlNextPath);
            return (0, exports.createFromTomlList)(next, currentOption);
        },
    });
};
exports.createFromToml = createFromToml;
const createFromTomlList = async (tomlPath, option) => {
    const list = (0, exports.readToml)(tomlPath)?.items ?? [];
    return await Promise.all(list.map((item) => (0, exports.createFromToml)(tomlPath, option, item)));
};
exports.createFromTomlList = createFromTomlList;
