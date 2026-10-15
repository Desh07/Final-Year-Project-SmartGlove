import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  ActivityIndicator,
  Easing,
} from 'react-native';
import {
  CalibrationEngine,
  FINGER_LABELS,
  STEP_DURATION_MS,
} from '../services/calibration';
import type { CalibrationData } from '../services/inference';

// Re-declare AppLanguage inside this file for self-containment
type AppLanguage = 'English' | 'Sinhala' | 'Tamil';

interface CalibrationScreenProps {
  appLanguage: AppLanguage;
  sensorData: { flex: number[]; imu: number[] } | null;
  isConnected: boolean;
  existingCalibration: CalibrationData | null;
  onSaveCalibration: (data: CalibrationData) => void;
  onClose: () => void;
  palette: any;
  baseStyles: any;
}

const FINGER_DISPLAY_NAMES = {
  English: [
    'Right Thumb', 'Right Index', 'Right Middle', 'Right Ring', 'Right Pinky',
    'Left Thumb', 'Left Index', 'Left Middle', 'Left Ring', 'Left Pinky',
  ],
  Sinhala: [
    'දකුණු මාපට ඇඟිල්ල', 'දකුණු දබර ඇඟිල්ල', 'දකුණු මැද ඇඟිල්ල', 'දකුණු මුදු ඇඟිල්ල', 'දකුණු සුළැඟිල්ල',
    'වම් මාපට ඇඟිල්ල', 'වම් දබර ඇඟිල්ල', 'වම් මැද ඇඟිල්ල', 'වම් මුදු ඇඟිල්ල', 'වම් සුළැඟිල්ල',
  ],
  Tamil: [
    'வலது பெருவிரல்', 'வலது ஆள்காட்டி விரல்', 'வலது நடுவிரல்', 'வலது மோதிர விரல்', 'வலது சுண்டு விரல்',
    'இடது பெருவிரல்', 'இடது ஆள்காட்டி விரல்', 'இடது நடுவிரல்', 'இடது மோதிர விரல்', 'இடது சுண்டு விரல்',
  ],
};

const ORIENTATION_DISPLAY_NAMES = {
  English: ['Palm Down (Flat)', 'Palm Up (Flat)', 'Tilt Left', 'Tilt Right'],
  Sinhala: ['අල්ල පහළට (තලාව)', 'අල්ල ඉහළට (තලාව)', 'වමට ඇල කරන්න', 'දකුණට ඇල කරන්න'],
  Tamil: ['உள்ளங்கை கீழ்நோக்கி', 'உள்ளங்கை மேல்நோக்கி', 'இடப்பக்கம் சாய்வு', 'வலப்பக்கம் சாய்வு'],
};

const localTranslations = {
  English: {
    title: 'Glove Calibrator',
    introTitle: 'Sensor Calibration',
    introDesc: 'Calibration trains the glove to recognize your hand\'s unique flex ranges and orientation offsets. Follow the instructions on each step.',
    startBtn: 'Start Calibration',
    useSavedBtn: 'Use Saved Calibration',
    savedFound: 'Saved calibration detected.',
    connectingGlove: 'Please connect your glove first to calibrate.',
    stepOpenHand: 'Step 1: Open Hand',
    descOpenHand: 'Keep your hand completely flat, open, and relaxed. Hold still.',
    stepFullFist: 'Step 2: Full Fist',
    descFullFist: 'Make a tight fist with all fingers fully bent. Hold still.',
    stepIndividual: 'Step 3: Finger Tuning',
    descIndividual: 'Bend only the requested finger. Keep all other fingers straight.',
    stepOrientations: 'Step 4: Orientation Tuning',
    descOrientations: 'Move your hand to the requested orientation and hold still.',
    completeTitle: 'Calibration Complete!',
    completeDesc: 'Your HandGlow glove is now calibrated and ready for real-time sign language recognition.',
    saveBtn: 'Save & Start Using',
    recalibrateBtn: 'Recalibrate',
    skipBtn: 'Skip Step',
    stepIndicator: 'Step {current} of {total}',
    flexSensors: 'Flex Sensors (Raw Input)',
    countdownLabel: 'seconds remaining',
  },
  Sinhala: {
    title: 'ග්ලවු ක්‍රමාංකකය',
    introTitle: 'සංවේදක ක්‍රමාංකනය',
    introDesc: 'ක්‍රමාංකනය මඟින් ඔබගේ අතෙහි සුවිශේෂී නැමීම් පරාසයන් සහ දිශානති ඕෆ්සෙට් හඳුනා ගැනීමට ග්ලවුව පුහුණු කරයි. එක් එක් පියවරෙහි උපදෙස් අනුගමනය කරන්න.',
    startBtn: 'ක්‍රමාංකනය අරඹන්න',
    useSavedBtn: 'සුරකින ලද ක්‍රමාංකනය භාවිතා කරන්න',
    savedFound: 'සුරකින ලද ක්‍රමාංකනයක් හමු විය.',
    connectingGlove: 'ක්‍රමාංකනය කිරීමට කරුණාකර පළමුව ඔබගේ ග්ලවුව සම්බන්ධ කරන්න.',
    stepOpenHand: 'පියවර 1: විවෘත අත',
    descOpenHand: 'ඔබේ අත සම්පූර්ණයෙන්ම සමතලා කර, විවෘත කර, ලිහිල්ව තබා ගන්න. නොසැලී සිටින්න.',
    stepFullFist: 'පියවර 2: මිටි අත',
    descFullFist: 'සියලුම ඇඟිලි සම්පූර්ණයෙන්ම නමා තදින් මිටක් සාදන්න. නොසැලී සිටින්න.',
    stepIndividual: 'පියවර 3: ඇඟිලි සුසර කිරීම',
    descIndividual: 'අදාළ ඇඟිල්ල පමණක් නමන්න. අනෙකුත් සියලුම ඇඟිලි කෙළින් තබා ගන්න.',
    stepOrientations: 'පියවර 4: දිශානති සුසර කිරීම',
    descOrientations: 'නියමිත දිශානතියට ඔබේ අත ගෙන ගොස් නොසැලී සිටින්න.',
    completeTitle: 'ක්‍රමාංකනය සම්පූර්ණයි!',
    completeDesc: 'ඔබගේ HandGlow ග්ලවුව දැන් ක්‍රමාංකනය කර ඇති අතර තත්‍ය කාලීන සංඥා භාෂාව හඳුනා ගැනීමට සූදානම්.',
    saveBtn: 'සුරකා භාවිතය අරඹන්න',
    recalibrateBtn: 'නැවත ක්‍රමාංකනය',
    skipBtn: 'මඟ හරින්න',
    stepIndicator: 'පියවර {current} න් {total}',
    flexSensors: 'නම්‍ය සංවේදක (මුල් ප්‍රතිදාන)',
    countdownLabel: 'තත්පර ඉතිරිව ඇත',
  },
  Tamil: {
    title: 'க்ளவ் அளவீடு',
    introTitle: 'சென்சார் அளவீடு',
    introDesc: 'அளவீடு என்பது உங்கள் கையின் தனித்துவமான வளைவு வரம்புகள் மற்றும் திசை ஆஃப்செட்களை அடையாளம் காண க்ளவ்க்கு பயிற்சி அளிக்கிறது. ஒவ்வொரு படியிலும் உள்ள வழிமுறைகளைப் பின்பற்றவும்.',
    startBtn: 'அளவீட்டைத் தொடங்கு',
    useSavedBtn: 'சேமித்த அளவீட்டைப் பயன்படுத்து',
    savedFound: 'சேமிக்கப்பட்ட அளவீடு கண்டறியப்பட்டது.',
    connectingGlove: 'அளவீடு செய்ய முதலில் உங்கள் க்ளவ்வை இணைக்கவும்.',
    stepOpenHand: 'படி 1: திறந்த கை',
    descOpenHand: 'உங்கள் கையை முற்றிலும் தட்டையாகவும், திறந்த நிலையிலும், தளர்வாகவும் வைத்திருங்கள். அசையாமல் இருங்கள்.',
    stepFullFist: 'படி 2: மூடிய முஷ்டி',
    descFullFist: 'அனைத்து விரல்களையும் முழுமையாக வளைத்து இறுக்கமான முஷ்டியை உருவாக்குங்கள். அசையாமல் இருங்கள்.',
    stepIndividual: 'படி 3: விரல் சரிசெய்தல்',
    descIndividual: 'கேட்கப்பட்ட விரலை மட்டும் வளைக்கவும். மற்ற விரல்களை நேராக வைக்கவும்.',
    stepOrientations: 'படி 4: திசை சரிசெய்தல்',
    descOrientations: 'உங்கள் கையை கேட்கப்பட்ட திசைக்கு நகர்த்தி அசையாமல் வைத்திருங்கள்.',
    completeTitle: 'அளவீடு முடிந்தது!',
    completeDesc: 'உங்கள் HandGlow க்ளவ் இப்போது அளவீடு செய்யப்பட்டு, நிகழ்நேர சைகை மொழி அங்கீகாரத்திற்கு தயாராக உள்ளது.',
    saveBtn: 'சேமித்து பயன்படுத்தத் தொடங்கு',
    recalibrateBtn: 'மீண்டும் அளவீடு செய்',
    skipBtn: 'படியைத் தவிர்',
    stepIndicator: 'படி {total}-இல் {current}',
    flexSensors: 'நெகிழ்வு சென்சார்கள் (மூல உள்ளீடு)',
    countdownLabel: 'விநாடிகள் மீதமுள்ளன',
  },
};

type CalibrationStep =
  | 'idle'
  | 'open_hand'
  | 'full_fist'
  | 'individual'
  | 'orientations'
  | 'complete';

export default function CalibrationScreen({
  appLanguage,
  sensorData,
  isConnected,
  existingCalibration,
  onSaveCalibration,
  onClose,
  palette,
  baseStyles,
}: CalibrationScreenProps) {
  const styles = useMemo(() => createLocalStyles(palette), [palette]);

  const [currentStep, setCurrentStep] = useState<CalibrationStep>('idle');
  const [subStep, setSubStep] = useState<number>(0);
  const [countdown, setCountdown] = useState<number>(5);
  const [finalCal, setFinalCal] = useState<CalibrationData | null>(null);

  const engine = useRef(new CalibrationEngine());
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Animation refs
  const circleProgressAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const t = localTranslations[appLanguage] || localTranslations.English;

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Collect sensor readings while calibrating
  useEffect(() => {
    const isCalibratingState = ['open_hand', 'full_fist', 'individual', 'orientations'].includes(currentStep);
    if (isCalibratingState && isConnected && sensorData) {
      engine.current.addSample(sensorData.flex, sensorData.imu);
    }
  }, [sensorData, currentStep, isConnected]);

  // Handle countdown ticks and step transition logic
  useEffect(() => {
    const isCalibratingState = ['open_hand', 'full_fist', 'individual', 'orientations'].includes(currentStep);
    
    if (!isCalibratingState) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      return;
    }

    // Set duration for steps (usually 5 seconds)
    const stepDurationSecs = 5;
    setCountdown(stepDurationSecs);
    circleProgressAnim.setValue(1);

    // Animate circular progress ring
    Animated.timing(circleProgressAnim, {
      toValue: 0,
      duration: stepDurationSecs * 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current!);
          countdownIntervalRef.current = null;
          handleStepComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [currentStep, subStep]);

  const handleStepComplete = () => {
    // Fade out effect before transition
    Animated.timing(fadeAnim, {
      toValue: 0.3,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      // Process step inside CalibrationEngine
      if (currentStep === 'open_hand') {
        engine.current.processOpenHand();
        engine.current.clearSamples();
        setCurrentStep('full_fist');
      } else if (currentStep === 'full_fist') {
        engine.current.processFullFist();
        engine.current.clearSamples();
        setCurrentStep('individual');
        setSubStep(0);
      } else if (currentStep === 'individual') {
        engine.current.processIndividualFinger(subStep);
        engine.current.clearSamples();
        if (subStep < 9) {
          setSubStep((prev) => prev + 1);
        } else {
          setCurrentStep('orientations');
          setSubStep(0);
        }
      } else if (currentStep === 'orientations') {
        engine.current.processOrientation();
        engine.current.clearSamples();
        if (subStep < 3) {
          setSubStep((prev) => prev + 1);
        } else {
          const result = engine.current.buildCalibrationData();
          setFinalCal(result);
          setCurrentStep('complete');
        }
      }
      
      // Fade back in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  };

  const handleStartCalibration = () => {
    if (!isConnected) return;
    engine.current.reset();
    setCurrentStep('open_hand');
  };

  const handleSkipStep = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    handleStepComplete();
  };

  const handleUseSaved = () => {
    if (existingCalibration) {
      onSaveCalibration(existingCalibration);
    }
  };

  // UI state metadata selectors
  const getStepProgressDetails = () => {
    // open_hand = 1, full_fist = 2, individual = 3 to 12, orientations = 13 to 16. Total steps = 16.
    let currentIdx = 0;
    if (currentStep === 'open_hand') currentIdx = 1;
    else if (currentStep === 'full_fist') currentIdx = 2;
    else if (currentStep === 'individual') currentIdx = 3 + subStep;
    else if (currentStep === 'orientations') currentIdx = 13 + subStep;

    const totalSteps = 16;
    return {
      currentIdx,
      totalSteps,
      label: t.stepIndicator.replace('{current}', String(currentIdx)).replace('{total}', String(totalSteps)),
      pct: `${(currentIdx / totalSteps) * 100}%` as any,
    };
  };

  const stepMeta = getStepProgressDetails();

  // Helper to render step title & instructions
  const renderStepInstruction = () => {
    switch (currentStep) {
      case 'open_hand':
        return (
          <>
            <Text style={styles.stepTitle}>{t.stepOpenHand}</Text>
            <Text style={styles.stepInstruction}>{t.descOpenHand}</Text>
            <Text style={styles.handSymbol}>🖐️</Text>
          </>
        );
      case 'full_fist':
        return (
          <>
            <Text style={styles.stepTitle}>{t.stepFullFist}</Text>
            <Text style={styles.stepInstruction}>{t.descFullFist}</Text>
            <Text style={styles.handSymbol}>✊</Text>
          </>
        );
      case 'individual':
        const fingerName = FINGER_DISPLAY_NAMES[appLanguage][subStep] || FINGER_DISPLAY_NAMES.English[subStep];
        return (
          <>
            <Text style={styles.stepTitle}>{t.stepIndividual} ({subStep + 1}/10)</Text>
            <Text style={styles.stepInstruction}>
              {t.descIndividual.replace('{fingerName}', fingerName)}
            </Text>
            <View style={styles.focusFingerContainer}>
              <Text style={styles.focusFingerText}>{fingerName}</Text>
              <Text style={styles.focusFingerArrow}>👇</Text>
            </View>
          </>
        );
      case 'orientations':
        const orientName = ORIENTATION_DISPLAY_NAMES[appLanguage][subStep] || ORIENTATION_DISPLAY_NAMES.English[subStep];
        return (
          <>
            <Text style={styles.stepTitle}>{t.stepOrientations} ({subStep + 1}/4)</Text>
            <Text style={styles.stepInstruction}>
              {t.descOrientations.replace('{orientationName}', orientName)}
            </Text>
            <View style={styles.focusFingerContainer}>
              <Text style={styles.focusFingerText}>{orientName}</Text>
              <Text style={styles.focusFingerArrow}>🔄</Text>
            </View>
          </>
        );
      default:
        return null;
    }
  };

  // Render raw sensor indicators to give real-time feedback
  const renderSensorBars = () => {
    if (!sensorData) return null;
    return (
      <View style={styles.sensorContainer}>
        <Text style={styles.sensorTitle}>{t.flexSensors}</Text>
        <View style={styles.sensorGrid}>
          {FINGER_LABELS.map((label, idx) => {
            const val = sensorData.flex[idx] ?? 0;
            // Flex raw values are usually 0-4095. Map to percentage.
            const pct = Math.max(0, Math.min(100, (val / 4095) * 100));
            return (
              <View key={label} style={styles.sensorRow}>
                <Text style={styles.sensorLabel}>{label}</Text>
                <View style={styles.sensorBarBackground}>
                  <View style={[styles.sensorBarFill, { width: `${pct}%` as any }]} />
                </View>
                <Text style={styles.sensorValue}>{val}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={baseStyles.profileScreenContent}>
      {/* Top Header */}
      <View style={styles.headerRow}>
        <Pressable onPress={onClose} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Close</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t.title}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* State: IDLE Intro Screen */}
      {currentStep === 'idle' && (
        <View style={styles.cardContainer}>
          <Text style={styles.introTitle}>{t.introTitle}</Text>
          <Text style={styles.introDesc}>{t.introDesc}</Text>

          <View style={styles.infoRow}>
            <View style={[styles.statusIndicator, isConnected ? styles.statusConnected : styles.statusDisconnected]} />
            <Text style={styles.statusText}>
              {isConnected ? 'Glove Connected' : 'Glove Disconnected'}
            </Text>
          </View>

          {!isConnected && (
            <Text style={styles.warningText}>{t.connectingGlove}</Text>
          )}

          <Pressable
            onPress={handleStartCalibration}
            style={[baseStyles.primaryButton, !isConnected && baseStyles.primaryButtonDisabled]}
            disabled={!isConnected}
          >
            <Text style={baseStyles.primaryButtonText}>{t.startBtn}</Text>
          </Pressable>

          {existingCalibration && (
            <View style={{ marginTop: 14 }}>
              <Text style={styles.savedNoticeText}>💡 {t.savedFound}</Text>
              <Pressable onPress={handleUseSaved} style={styles.outlineButton}>
                <Text style={styles.outlineButtonText}>{t.useSavedBtn}</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* State: RUNNING CALIBRATION (Steps 1-4) */}
      {['open_hand', 'full_fist', 'individual', 'orientations'].includes(currentStep) && (
        <Animated.View style={[styles.cardContainer, { opacity: fadeAnim }]}>
          {/* Top Progress bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressRow}>
              <Text style={styles.progressText}>{stepMeta.label}</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: stepMeta.pct }]} />
            </View>
          </View>

          {/* Central Instruction Area */}
          <View style={styles.instructionContainer}>
            {renderStepInstruction()}
          </View>

          {/* Animated Countdown Ring */}
          <View style={styles.timerWrapper}>
            <View style={styles.timerCircle}>
              <Text style={styles.timerNumber}>{countdown}</Text>
              <Text style={styles.timerSubText}>sec</Text>
            </View>
          </View>

          {/* Control Buttons */}
          <View style={styles.actionRow}>
            <Pressable onPress={handleSkipStep} style={styles.skipButton}>
              <Text style={styles.skipButtonText}>{t.skipBtn} ➔</Text>
            </Pressable>
          </View>

          {/* Live Feedback Section */}
          {renderSensorBars()}
        </Animated.View>
      )}

      {/* State: COMPLETE Screen */}
      {currentStep === 'complete' && (
        <View style={styles.cardContainer}>
          <Text style={styles.successEmoji}>🎉</Text>
          <Text style={styles.introTitle}>{t.completeTitle}</Text>
          <Text style={styles.introDesc}>{t.completeDesc}</Text>

          <Pressable
            onPress={() => {
              if (finalCal) {
                onSaveCalibration(finalCal);
              }
            }}
            style={baseStyles.primaryButton}
          >
            <Text style={baseStyles.primaryButtonText}>{t.saveBtn}</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              setCurrentStep('open_hand');
              engine.current.reset();
            }}
            style={styles.outlineButton}
          >
            <Text style={styles.outlineButtonText}>{t.recalibrateBtn}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const createLocalStyles = (palette: any) =>
  StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    backButton: {
      padding: 6,
    },
    backButtonText: {
      fontSize: 16,
      color: palette.red,
      fontWeight: '600',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '800',
      color: palette.ink,
    },
    cardContainer: {
      backgroundColor: palette.white,
      borderRadius: 20,
      padding: 22,
      borderWidth: 1,
      borderColor: palette.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 10,
      elevation: 3,
      marginBottom: 20,
    },
    introTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: palette.ink,
      marginBottom: 10,
      textAlign: 'center',
    },
    introDesc: {
      fontSize: 14,
      color: palette.muted,
      lineHeight: 22,
      textAlign: 'center',
      marginBottom: 20,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 20,
      backgroundColor: palette.soft,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 12,
    },
    statusIndicator: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    statusConnected: {
      backgroundColor: palette.success,
    },
    statusDisconnected: {
      backgroundColor: palette.red,
    },
    statusText: {
      fontSize: 14,
      fontWeight: '600',
      color: palette.ink,
    },
    warningText: {
      color: palette.red,
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 16,
      fontWeight: '500',
    },
    savedNoticeText: {
      color: palette.muted,
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 8,
      fontWeight: '600',
    },
    outlineButton: {
      borderWidth: 1.5,
      borderColor: palette.border,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: 'center',
      backgroundColor: palette.white,
      marginTop: 8,
    },
    outlineButtonText: {
      color: palette.ink,
      fontWeight: '700',
    },
    progressContainer: {
      marginBottom: 20,
    },
    progressRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    progressText: {
      fontSize: 12,
      fontWeight: '700',
      color: palette.red,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    progressBarBg: {
      height: 6,
      backgroundColor: palette.soft,
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: palette.red,
      borderRadius: 3,
    },
    instructionContainer: {
      alignItems: 'center',
      minHeight: 140,
      justifyContent: 'center',
      marginBottom: 16,
    },
    stepTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: palette.ink,
      marginBottom: 8,
      textAlign: 'center',
    },
    stepInstruction: {
      fontSize: 14,
      color: palette.muted,
      lineHeight: 20,
      textAlign: 'center',
      paddingHorizontal: 10,
    },
    handSymbol: {
      fontSize: 54,
      marginTop: 14,
    },
    focusFingerContainer: {
      backgroundColor: 'rgba(99, 102, 241, 0.08)',
      borderColor: 'rgba(99, 102, 241, 0.2)',
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 16,
    },
    focusFingerText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#6366f1',
    },
    focusFingerArrow: {
      fontSize: 16,
    },
    timerWrapper: {
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 14,
    },
    timerCircle: {
      width: 100,
      height: 100,
      borderRadius: 50,
      borderWidth: 6,
      borderColor: palette.red,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.soft,
    },
    timerNumber: {
      fontSize: 34,
      fontWeight: '900',
      color: palette.ink,
    },
    timerSubText: {
      fontSize: 11,
      color: palette.muted,
      textTransform: 'uppercase',
      fontWeight: '700',
      marginTop: -2,
    },
    actionRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: 20,
    },
    skipButton: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: palette.soft,
      borderWidth: 1,
      borderColor: palette.border,
    },
    skipButtonText: {
      color: palette.ink,
      fontSize: 13,
      fontWeight: '700',
    },
    sensorContainer: {
      borderTopWidth: 1,
      borderTopColor: palette.border,
      paddingTop: 16,
    },
    sensorTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: palette.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 10,
    },
    sensorGrid: {
      gap: 6,
    },
    sensorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    sensorLabel: {
      width: 46,
      fontSize: 11,
      fontWeight: '700',
      color: palette.ink,
    },
    sensorBarBackground: {
      flex: 1,
      height: 8,
      backgroundColor: palette.soft,
      borderRadius: 4,
      overflow: 'hidden',
    },
    sensorBarFill: {
      height: '100%',
      backgroundColor: palette.success,
      borderRadius: 4,
    },
    sensorValue: {
      width: 32,
      fontSize: 11,
      textAlign: 'right',
      color: palette.muted,
      fontFamily: 'monospace',
    },
    successEmoji: {
      fontSize: 54,
      textAlign: 'center',
      marginBottom: 10,
    },
  });
