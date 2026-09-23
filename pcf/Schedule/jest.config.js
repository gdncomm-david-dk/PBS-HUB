/** Unit tests for the pure logic in Schedule/core. The PCF build does not include these. */
module.exports = {
    testEnvironment: "node",
    roots: ["<rootDir>/tests"],
    transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs", target: "es2019", strict: true, esModuleInterop: true, types: ["jest", "node", "powerapps-component-framework"] } }],
    },
};
