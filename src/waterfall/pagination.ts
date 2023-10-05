export class Pagination {
	constructor(detail: JQuery) {
		this.detail = detail;
	}

	currentURL: string = location.toString()
	isEnd: boolean = false
	nextUrl: string | null = null
	detail: JQuery;
	nextDetail: JQuery | null = null
}