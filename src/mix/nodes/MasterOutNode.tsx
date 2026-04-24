import { Handle, Position } from 'reactflow'
import { motion } from 'motion/react'
import { Speaker } from 'lucide-react'
import { springs } from '@/motion/springs'

export function MasterOutNode() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springs.silky}
      className="w-44 rounded-full border border-[var(--wp-border)] bg-gradient-to-br from-[var(--wp-accent)] to-[var(--wp-accent-hi)] text-white shadow-[0_0_40px_rgba(110,93,187,0.4)]"
    >
      <div className="flex items-center gap-2 px-5 py-4">
        <Speaker className="h-5 w-5" />
        <div className="font-display text-lg tracking-tight">Master</div>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3.5 !h-3.5 !bg-white !border-[var(--wp-accent)]" />
    </motion.div>
  )
}
