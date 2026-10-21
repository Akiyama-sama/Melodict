import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { marked } from 'marked';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import rawAgreement from '../../../../../docs/agreement.md?raw';
import Button from '../Button';
import Checkbox from '../Checkbox';

type Props = {
  isOpen: boolean;
  /** Persists the accepted version and closes the dialog. */
  onAccept: () => void;
  /** Invoked when the user explicitly declines; the app is expected to quit afterwards. */
  onDecline: () => void;
};

/**
 * The blocking consent dialog for docs/agreement.md.
 *
 * Rendered at the app root while `preferences.agreedAgreementVersion` is lower than
 * `CURRENT_AGREEMENT_VERSION` (i.e. on first launch and whenever the agreement text
 * changes). The dialog cannot be dismissed by clicking outside: the user has to either
 * accept or quit.
 */
const AgreementPrompt = (props: Props) => {
  const { isOpen, onAccept, onDecline } = props;
  const { t } = useTranslation();

  const [hasReadAgreement, setHasReadAgreement] = useState(false);

  const agreementHtml = useMemo(
    () =>
      // The agreement is a first-party document shipped in the repository, so rendering
      // its markdown as HTML here is safe.
      marked.parse(rawAgreement, { async: false }),
    []
  );

  return (
    <Dialog open={isOpen} onClose={() => {}} className="relative z-100">
      <DialogBackdrop className="fixed inset-0 h-screen bg-black/50" />
      <div className="fixed inset-0 z-10 flex h-screen w-screen items-center justify-center overflow-y-auto p-4">
        <DialogPanel
          transition
          className="bg-background-color-1 dark:bg-dark-background-color-1 text-font-color-black dark:text-font-color-white relative flex max-h-[90%] w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-xl"
        >
          <div className="shrink-0 px-6 pt-6 pb-2">
            <DialogTitle className="text-font-color-highlight dark:text-dark-font-color-highlight flex items-center text-2xl font-medium">
              <span className="material-icons-round-outlined mr-2 text-3xl">gavel</span>
              {t('agreementPrompt.title')}
            </DialogTitle>
            <p className="mt-2 text-sm opacity-70">{t('agreementPrompt.intro')}</p>
          </div>

          <div
            className="agreement-content mt-2 min-h-0 flex-1 overflow-y-auto px-6 text-sm leading-6 [&_a]:text-font-color-highlight [&_a]:dark:text-dark-font-color-highlight [&_h1]:hidden [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-medium [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-medium [&_hr]:border-background-color-3 [&_hr]:dark:border-dark-background-color-3 [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-6"
            dangerouslySetInnerHTML={{ __html: agreementHtml }}
          />

          <div className="shrink-0 px-6 pt-2 pb-5">
            <Checkbox
              id="agreementHasReadCheckbox"
              className="ml-0!"
              isChecked={hasReadAgreement}
              labelContent={t('agreementPrompt.hasReadCheckbox')}
              checkedStateUpdateFunction={setHasReadAgreement}
            />
            <div className="mt-4 flex justify-end gap-4">
              <Button
                label={t('agreementPrompt.decline')}
                clickHandler={onDecline}
                tooltipLabel={t('agreementPrompt.decline')}
              />
              <Button
                label={t('agreementPrompt.accept')}
                isDisabled={!hasReadAgreement}
                clickHandler={onAccept}
                tooltipLabel={t('agreementPrompt.accept')}
              />
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
};

export default AgreementPrompt;
