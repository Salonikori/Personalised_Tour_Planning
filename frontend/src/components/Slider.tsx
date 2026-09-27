import type { InputHTMLAttributes } from 'react'
export function Slider({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <label className="tp-slider-wrap"><span>{label}</span><input className="tp-slider" type="range" {...props} /></label> }
