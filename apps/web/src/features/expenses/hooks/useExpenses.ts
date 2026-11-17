import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../../../services/apiClient'
import { expensesApi } from '../services/expensesApi'
import type { Expense } from '../types'
export function useExpenses(){const [expenses,setExpenses]=useState<Expense[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');const reload=useCallback(async()=>{setLoading(true);setError('');try{setExpenses((await expensesApi.list()).expenses)}catch(e){setError(errorMessage(e))}finally{setLoading(false)}},[]);useEffect(()=>{void reload()},[reload]);return{expenses,loading,error,reload}}
