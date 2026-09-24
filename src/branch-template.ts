/** Branch-name template rendering — pure, shared by the Host and the browser half. */

/** The one default template, declared once for the schema and both consumers. */
export const DEFAULT_BRANCH_TEMPLATE = 'feature/YYYYMMDD-'


/** Expand the branch-name template: `YYYY`, `MM`, `DD` become today's date. */
export function renderBranchTemplate(template: string, now = new Date()): string {
  const yyyy = String(now.getFullYear()).padStart(4, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return template.replaceAll('YYYY', yyyy).replaceAll('MM', mm).replaceAll('DD', dd)
}
