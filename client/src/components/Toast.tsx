import { CheckCircle2, X } from 'lucide-react'
export function Toast({ message, onClose }: { message: string; onClose: () => void }) { if (!message) return null; return <div className="toast"><CheckCircle2 size={17}/><span>{message}</span><button onClick={onClose}><X size={16}/></button></div> }
