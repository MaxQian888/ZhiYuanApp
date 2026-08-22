"use client"

import { useState } from "react"
import { Field, PageHeader, Section, StatusPill } from "@/components/product/primitives"
import { executeAction } from "@/components/product/view-kit"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useCopy } from "@/lib/i18n-product"
import { useProductStore } from "@/stores/product-store"

export function TasksView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [failureTaskId, setFailureTaskId] = useState<number | null>(null)
  const [failureReason, setFailureReason] = useState("")
  return (
    <>
      <PageHeader
        title={copy.tasks}
        description={
          store.locale === "zh-CN"
            ? "执行配送状态机，非法状态跳转不会提交。"
            : "Run the delivery state machine; invalid transitions are rejected."
        }
      />
      <Section title={`${copy.tasks} · ${store.tasks.length}`}>
        <div className="task-list">
          {store.tasks.map((task) => (
            <div className="task-row" key={task.id}>
              <span>
                <strong>TSK-{String(task.id).padStart(4, "0")}</strong>
                <small>{store.orders.find((item) => item.id === task.orderId)?.orderNo}</small>
              </span>
              <span>{store.uavs.find((item) => item.id === task.uavId)?.code}</span>
              <StatusPill value={task.taskStatus} />
              {task.failureReason && <small>{task.failureReason}</small>}
              <div>
                {task.taskStatus === "WAITING" && (
                  <Button
                    className="text-button"
                    onClick={() =>
                      void executeAction(
                        () => store.transitionTask(task.id, "FLYING"),
                        store.locale,
                        copy.startTask
                      )
                    }
                  >
                    {copy.startTask}
                  </Button>
                )}
                {task.taskStatus === "FLYING" && (
                  <>
                    <Button
                      className="text-button"
                      onClick={() =>
                        void executeAction(
                          () => store.transitionTask(task.id, "ARRIVED"),
                          store.locale,
                          copy.arrive
                        )
                      }
                    >
                      {copy.arrive}
                    </Button>
                    <Button
                      className="text-button danger-text"
                      onClick={() => setFailureTaskId(task.id)}
                    >
                      {copy.fail}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Dialog
        open={failureTaskId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFailureTaskId(null)
            setFailureReason("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {store.locale === "zh-CN" ? "记录失败原因" : "Record failure"}
            </DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "失败原因会写入任务记录并用于后续重调度复盘。"
                : "The reason is stored with the task for retry review."}
            </DialogDescription>
          </DialogHeader>
          <Field label={store.locale === "zh-CN" ? "失败原因" : "Failure reason"}>
            <Textarea
              value={failureReason}
              onChange={(event) => setFailureReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setFailureTaskId(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-danger"
              disabled={!failureReason.trim()}
              onClick={() => {
                if (failureTaskId === null) return
                void executeAction(
                  () => store.transitionTask(failureTaskId, "FAILED", failureReason.trim()),
                  store.locale,
                  copy.fail
                ).then((result) => {
                  if (!result.ok) return
                  setFailureTaskId(null)
                  setFailureReason("")
                })
              }}
            >
              {copy.fail}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
