import { apiRequest } from '../../../services/apiClient'
import type { Expense, ExpenseDraft } from '../types'
export const expensesApi = {
 list: () => apiRequest<{expenses:Expense[]}>('/expenses'),
 create: (draft:ExpenseDraft) => apiRequest<{expense:Expense}>('/expenses',{method:'POST',body:JSON.stringify(draft)}),
 update: (id:string,draft:ExpenseDraft) => apiRequest<{expense:Expense}>(`/expenses/${id}`,{method:'PATCH',body:JSON.stringify(draft)}),
 remove: (id:string) => apiRequest<{expense:Expense}>(`/expenses/${id}`,{method:'DELETE'}),
 jobs: () => apiRequest<{jobs:Array<{id:string;jobNumber:string;title:string}>}>('/jobs'),
}
