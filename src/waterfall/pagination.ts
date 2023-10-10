export class Pagination {
	constructor(detail: JQuery) {
		this.detail = detail;
	}

	currentURL: string = location.toString()
	pathname: string = location.pathname
	isEnd: boolean = false
	nextUrl: string | null = null
	detail: JQuery;
	nextDetail: JQuery | null = null
}