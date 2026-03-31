// .md 文件通过 esbuild text loader 作为字符串内联引入。
declare module '*.md' {
	const content: string;
	export default content;
}
